import { analyzeLayout, getItemBounds } from '../../shared/layoutRules'
import { getDeviceDefinition, type DeskItem, type IssueEntry, type WorkspacePlan } from '../../shared/models'

export type FixFailureReason = 'oversize' | 'blocked'

export interface FixMove {
  itemId: string
  fromX: number
  fromY: number
  toX: number
  toY: number
  deltaX: number
  deltaY: number
  distanceMm: number
}

export interface FixFailure {
  itemId: string
  reason: FixFailureReason
  detail: string
}

export interface FixResult {
  items: DeskItem[]
  moves: FixMove[]
  failures: FixFailure[]
  beforeEntries: IssueEntry[]
  afterEntries: IssueEntry[]
  attemptedItemIds: string[]
  fixedItemIds: string[]
}

const EPS = 0.05
const MAX_ITERATIONS = 400

interface AxisRange {
  minX: number
  maxX: number
  minY: number
  maxY: number
  fitsX: boolean
  fitsY: boolean
  boundsWidth: number
  boundsHeight: number
}

/** 平移不会改变旋转包围盒的宽高，因此每件设备都有固定的合法坐标区间 */
function getAxisRange(item: DeskItem, deskWidth: number, deskHeight: number): AxisRange {
  const bounds = getItemBounds(item)
  return {
    minX: bounds.width / 2 - item.widthMm / 2,
    maxX: deskWidth - bounds.width / 2 - item.widthMm / 2,
    minY: bounds.height / 2 - item.heightMm / 2,
    maxY: deskHeight - bounds.height / 2 - item.heightMm / 2,
    fitsX: bounds.width <= deskWidth + EPS,
    fitsY: bounds.height <= deskHeight + EPS,
    boundsWidth: bounds.width,
    boundsHeight: bounds.height,
  }
}

function clampItemIntoDesk(item: DeskItem, deskWidth: number, deskHeight: number): DeskItem {
  const range = getAxisRange(item, deskWidth, deskHeight)
  // 只要有一条轴放不下桌面，任何平移都无法让它完整回到桌面内，此时不动它
  if (!range.fitsX || !range.fitsY) return item
  let { x, y } = item
  x = Math.min(range.maxX, Math.max(range.minX, x))
  y = Math.min(range.maxY, Math.max(range.minY, y))
  if (Math.abs(x - item.x) < EPS && Math.abs(y - item.y) < EPS) return item
  return { ...item, x: roundPosition(x), y: roundPosition(y) }
}

function itemFitsDesk(item: DeskItem, deskWidth: number, deskHeight: number): boolean {
  const range = getAxisRange(item, deskWidth, deskHeight)
  return range.fitsX && range.fitsY
}

function roundPosition(value: number): number {
  return Math.round(value * 10) / 10
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

interface PairOverlap {
  a: DeskItem
  b: DeskItem
  centerDeltaX: number
  centerDeltaY: number
  penetrationX: number
  penetrationY: number
}

function findOverlaps(items: DeskItem[]): PairOverlap[] {
  const bounds = new Map(items.map((item) => [item.id, getItemBounds(item)]))
  const pairs: PairOverlap[] = []
  for (let index = 0; index < items.length; index += 1) {
    for (let next = index + 1; next < items.length; next += 1) {
      const a = items[index]
      const b = items[next]
      const ab = bounds.get(a.id)
      const bb = bounds.get(b.id)
      if (!ab || !bb) continue
      const penetrationX = Math.min(ab.right, bb.right) - Math.max(ab.left, bb.left)
      const penetrationY = Math.min(ab.bottom, bb.bottom) - Math.max(ab.top, bb.top)
      if (penetrationX > 1 && penetrationY > 1) {
        pairs.push({
          a,
          b,
          centerDeltaX: ab.left + ab.width / 2 - (bb.left + bb.width / 2),
          centerDeltaY: ab.top + ab.height / 2 - (bb.top + bb.height / 2),
          penetrationX,
          penetrationY,
        })
      }
    }
  }
  return pairs
}

interface AxisMove {
  id: string
  delta: number
}

interface SeparationPlan {
  axis: 'x' | 'y'
  moves: AxisMove[]
}

/**
 * 在一条轴上分开一对设备：需要让两件设备合计移动 penetration。
 * bias 为负方向那件优先承担的比例：0.5 各走一半（单步移动量最小），
 * 0/1 用于多策略重试以跳出局部死胡同；受边界限制时把剩余量分给另一件。
 */
function planAxisSeparation(pair: PairOverlap, axis: 'x' | 'y', itemsById: Map<string, DeskItem>, ranges: Map<string, AxisRange>, movable: Set<string>, bias = 0.5): AxisMove[] | null {
  const penetration = axis === 'x' ? pair.penetrationX : pair.penetrationY
  const centerDelta = axis === 'x' ? pair.centerDeltaX : pair.centerDeltaY
  // 中心偏左/偏上的一件往负方向推，另一件往正方向推；中心重合时按 id 排序保证结果稳定
  const [negative, positive] = centerDelta !== 0
    ? (centerDelta < 0 ? [pair.a, pair.b] : [pair.b, pair.a])
    : (pair.a.id < pair.b.id ? [pair.a, pair.b] : [pair.b, pair.a])

  const capFor = (item: DeskItem, direction: -1 | 1): number => {
    if (!movable.has(item.id)) return 0
    const itemNow = itemsById.get(item.id) ?? item
    const range = ranges.get(item.id)
    if (!range || !itemNow) return 0
    if (axis === 'x') return direction < 0 ? Math.max(0, itemNow.x - range.minX) : Math.max(0, range.maxX - itemNow.x)
    return direction < 0 ? Math.max(0, itemNow.y - range.minY) : Math.max(0, range.maxY - itemNow.y)
  }

  const capNegative = capFor(negative, -1)
  const capPositive = capFor(positive, 1)
  if (capNegative + capPositive + EPS < penetration) return null

  const preferredNegative = penetration * bias
  const negativeMove = clamp(preferredNegative, Math.max(0, penetration - capPositive), capNegative)
  const positiveMove = penetration - negativeMove
  const moves: AxisMove[] = []
  if (negativeMove > EPS) moves.push({ id: negative.id, delta: -negativeMove })
  if (positiveMove > EPS) moves.push({ id: positive.id, delta: positiveMove })
  return moves
}

interface RelaxStrategy {
  /** 每轮挑选设备对的顺序 */
  pairOrder: 'deepest' | 'shallowest'
  /** 负方向设备承担的位移比例 */
  bias: number
}

const RELAX_STRATEGIES: RelaxStrategy[] = [
  { pairOrder: 'deepest', bias: 0.5 },
  { pairOrder: 'shallowest', bias: 0.5 },
  { pairOrder: 'deepest', bias: 1 },
  { pairOrder: 'deepest', bias: 0 },
  { pairOrder: 'shallowest', bias: 1 },
  { pairOrder: 'shallowest', bias: 0 },
]

interface RelaxOutcome {
  items: DeskItem[]
  totalMove: number
}

/** 迭代消除重叠：每一步处理一对，沿最小穿透轴移动，直到全部错开或确认推不动 */
function relaxWithStrategy(initial: DeskItem[], deskWidth: number, deskHeight: number, movable: Set<string>, strategy: RelaxStrategy): RelaxOutcome {
  const originPositions = new Map(initial.map((item) => [item.id, { x: item.x, y: item.y }]))
  let working = initial.map((item) => ({ ...item }))
  const blockedPairs = new Set<string>()
  let iterations = 0

  while (iterations < MAX_ITERATIONS) {
    iterations += 1
    const pairs = findOverlaps(working)
      .filter((pair) => !blockedPairs.has(pairKey(pair.a.id, pair.b.id)))
      .sort((left, right) => {
        const leftDepth = Math.min(left.penetrationX, left.penetrationY)
        const rightDepth = Math.min(right.penetrationX, right.penetrationY)
        return strategy.pairOrder === 'deepest' ? rightDepth - leftDepth : leftDepth - rightDepth
      })
    if (pairs.length === 0) break

    const pair = pairs[0]
    const ranges = new Map(working.map((item) => [item.id, getAxisRange(item, deskWidth, deskHeight)]))
    const itemsById = new Map(working.map((item) => [item.id, item]))
    const preferX = pair.penetrationX <= pair.penetrationY
    const primaryAxis: 'x' | 'y' = preferX ? 'x' : 'y'
    const secondaryAxis: 'x' | 'y' = preferX ? 'y' : 'x'
    const primaryMoves = planAxisSeparation(pair, primaryAxis, itemsById, ranges, movable, strategy.bias)
    const plan: SeparationPlan | null = primaryMoves
      ? { axis: primaryAxis, moves: primaryMoves }
      : (() => {
          const secondaryMoves = planAxisSeparation(pair, secondaryAxis, itemsById, ranges, movable, strategy.bias)
          return secondaryMoves ? { axis: secondaryAxis, moves: secondaryMoves } : null
        })()
    if (!plan) {
      blockedPairs.add(pairKey(pair.a.id, pair.b.id))
      continue
    }
    blockedPairs.clear()
    working = working.map((item) => {
      const move = plan.moves.find((candidate) => candidate.id === item.id)
      if (!move) return item
      return plan.axis === 'x'
        ? { ...item, x: roundPosition(item.x + move.delta) }
        : { ...item, y: roundPosition(item.y + move.delta) }
    })
  }

  let totalMove = 0
  working.forEach((item) => {
    const origin = originPositions.get(item.id)
    if (origin) totalMove += Math.hypot(item.x - origin.x, item.y - origin.y)
  })
  return { items: working, totalMove }
}

/** 用多种确定性策略尝试，选残留重叠最少、总移动最小的结果；全部失败才认定为真的推不动 */
function relaxOverlaps(items: DeskItem[], deskWidth: number, deskHeight: number, movable: Set<string>): DeskItem[] {
  let best: RelaxOutcome | null = null
  for (const strategy of RELAX_STRATEGIES) {
    const outcome = relaxWithStrategy(items, deskWidth, deskHeight, movable, strategy)
    if (!best) {
      best = outcome
      continue
    }
    const bestRemaining = findOverlaps(best.items).length
    const outcomeRemaining = findOverlaps(outcome.items).length
    if (outcomeRemaining < bestRemaining || (outcomeRemaining === bestRemaining && outcome.totalMove < best.totalMove - EPS)) {
      best = outcome
    }
  }
  return best?.items ?? items
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

function describeDevice(itemType: DeskItem['type']): string {
  return getDeviceDefinition(itemType).label
}

function buildFailures(entries: IssueEntry[], items: DeskItem[], deskWidth: number, deskHeight: number, attempted: Set<string>): FixFailure[] {
  const failures: FixFailure[] = []
  const scopeIsSingle = attempted.size === 1
  entries.forEach((entry) => {
    const item = items.find((candidate) => candidate.id === entry.itemId)
    if (!item) return
    const range = getAxisRange(item, deskWidth, deskHeight)
    const wasAttempted = attempted.has(entry.itemId)
    const isSingleTarget = scopeIsSingle && wasAttempted

    if (entry.kinds.includes('outOfBounds')) {
      const oversizeParts: string[] = []
      if (!range.fitsX) oversizeParts.push(`投影宽度 ${Math.round(range.boundsWidth)} mm 超过桌面宽度 ${deskWidth} mm`)
      if (!range.fitsY) oversizeParts.push(`投影深度 ${Math.round(range.boundsHeight)} mm 超过桌面深度 ${deskHeight} mm`)
      if (oversizeParts.length > 0) {
        failures.push({ itemId: item.id, reason: 'oversize', detail: `${oversizeParts.join('；')}，完整放回桌面在物理上不可能，需要先缩小设备或加大桌面` })
        return
      }
    }
    if (entry.kinds.includes('overlap')) {
      const others = entry.overlaps.map((overlap) => `「${describeDevice(overlap.otherType)}」`).join('、')
      let prefix: string
      if (isSingleTarget) {
        prefix = `只移动这件设备时仍与 ${others} 重叠：该设备和周边设备沿最小移动方向都顶到了桌面边缘，单件无法独立脱开（可尝试「一键修复全部」让其他设备一起让行）`
      } else if (wasAttempted) {
        prefix = `仍与 ${others} 重叠：沿最小移动方向已经顶到桌面边缘，桌面上腾不出足够空隙`
      } else {
        prefix = `与 ${others} 的重叠未能解除：对方沿最小移动方向已经顶到桌面边缘，桌面上腾不出足够空隙`
      }
      failures.push({ itemId: item.id, reason: 'blocked', detail: `${prefix}，请手动挪开、缩小设备或加大桌面` })
    }
  })
  return failures
}

/**
 * 自动修复。itemId 为空时修复整个方案；传入 id 时只允许这一件设备移动，
 * 其余设备视为不可移动的障碍物。
 */
export function autoFixLayout(plan: WorkspacePlan, itemId?: string): FixResult {
  const beforeAnalysis = analyzeLayout(plan)
  const attemptedItemIds = itemId
    ? beforeAnalysis.entries.filter((entry) => entry.itemId === itemId).map((entry) => entry.itemId)
    : beforeAnalysis.entries.map((entry) => entry.itemId)
  const attempted = new Set(attemptedItemIds)
  const origins = new Map(plan.items.map((item) => [item.id, { x: item.x, y: item.y }]))

  // 第一步：越界的推回桌面（单件模式只推目标那一件）
  let items = plan.items.map((item) => (attempted.has(item.id) ? clampItemIntoDesk(item, plan.deskWidthMm, plan.deskHeightMm) : item))
  // 第二步：按最小移动量迭代分开重叠。放不下桌面的设备是“挪不动”的障碍，只允许能完整放下的设备移动
  const movable = new Set(
    items
      .filter((item) => (itemId ? item.id === itemId : true))
      .filter((item) => itemFitsDesk(item, plan.deskWidthMm, plan.deskHeightMm))
      .map((item) => item.id),
  )
  items = relaxOverlaps(items, plan.deskWidthMm, plan.deskHeightMm, movable)

  const afterAnalysis = analyzeLayout({ ...plan, items })
  const moves: FixMove[] = []
  items.forEach((item) => {
    const origin = origins.get(item.id)
    if (!origin) return
    const deltaX = item.x - origin.x
    const deltaY = item.y - origin.y
    if (Math.hypot(deltaX, deltaY) < 0.5) return
    moves.push({
      itemId: item.id,
      fromX: origin.x,
      fromY: origin.y,
      toX: item.x,
      toY: item.y,
      deltaX,
      deltaY,
      distanceMm: Math.hypot(deltaX, deltaY),
    })
  })

  const remainingIds = new Set(afterAnalysis.entries.map((entry) => entry.itemId))
  const fixedItemIds = attemptedItemIds.filter((id) => !remainingIds.has(id))
  const failures = buildFailures(afterAnalysis.entries, items, plan.deskWidthMm, plan.deskHeightMm, attempted)

  return {
    items,
    moves,
    failures,
    beforeEntries: beforeAnalysis.entries,
    afterEntries: afterAnalysis.entries,
    attemptedItemIds,
    fixedItemIds,
  }
}
