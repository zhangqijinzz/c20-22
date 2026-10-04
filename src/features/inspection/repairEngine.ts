import { GAP_MM, analyzeLayout, getItemBounds, rectanglesOverlap } from '../../shared/layoutRules'
import type { DeskItem, ItemBounds, LayoutAnalysis, WorkspacePlan } from '../../shared/models'

export type RepairKind = 'bounds' | 'overlap'

export interface RepairAction {
  kind: RepairKind
  itemId: string
  /** 本动作让该设备平移的目标坐标（左上角，mm）；跨多个动作时以最后一次为准 */
  x: number
  y: number
  /** 这一步平移的距离（mm） */
  distanceMm: number
}

export interface RepairReport {
  /** 修复尝试后的布局（可能仍有问题） */
  plan: WorkspacePlan
  /** 每一步实际执行过的移动，按时间顺序 */
  actions: RepairAction[]
  /** 修复前的检查结果 */
  before: LayoutAnalysis
  /** 修复后重新检查的真实结果 */
  after: LayoutAnalysis
  /** 单件修复时被限定的设备 id；整局修复时为 null */
  scopeItemId: string | null
  /** 仍然残留的问题：重叠的设备对（含压住的对方） */
  remainingOverlapItemIds: string[]
  /** 仍然残留的越界设备 */
  remainingOutOfBoundsItemIds: string[]
  /** 确实修不动时给出原因，键为设备 id；没有残留问题时为空 */
  reasons: Record<string, string>
  /** 整局修复：全部问题清零；单件修复：该设备已无问题 */
  ok: boolean
}

const EPS = 0.5

function cloneItems(items: DeskItem[]): DeskItem[] {
  return items.map((item) => ({ ...item }))
}

/** 越界设备：沿越出方向推回到桌面内，移动量刚好等于越界量 */
function clampIntoDesk(item: DeskItem, plan: WorkspacePlan): RepairAction | null {
  const bounds = getItemBounds(item)
  let dx = 0
  let dy = 0
  if (bounds.left < 0) dx = -bounds.left
  else if (bounds.right > plan.deskWidthMm) dx = plan.deskWidthMm - bounds.right
  if (bounds.top < 0) dy = -bounds.top
  else if (bounds.bottom > plan.deskHeightMm) dy = plan.deskHeightMm - bounds.bottom

  // 设备本身比桌面还大：单靠平移无法完全放回，推到尽量靠内的位置
  if (bounds.width > plan.deskWidthMm) dx = -bounds.left
  if (bounds.height > plan.deskHeightMm) dy = -bounds.top

  if (Math.abs(dx) < EPS && Math.abs(dy) < EPS) return null
  const x = item.x + dx
  const y = item.y + dy
  return { kind: 'bounds', itemId: item.id, x, y, distanceMm: Math.hypot(dx, dy) }
}

interface PushCandidate {
  axis: 'x' | 'y'
  direction: 1 | -1
  distance: number
}

/**
 * 列出 movable 脱离 fixed 的候选平移：沿侵入较浅或较深的轴、正反两个方向，
 * 只保留移动后仍在桌面内的方向。
 */
function feasiblePushes(movable: ItemBounds, fixed: ItemBounds, deskWidth: number, deskHeight: number): PushCandidate[] {
  const overlapX = Math.min(movable.right, fixed.right) - Math.max(movable.left, fixed.left) + GAP_MM
  const overlapY = Math.min(movable.bottom, fixed.bottom) - Math.max(movable.top, fixed.top) + GAP_MM
  const centerMovableX = (movable.left + movable.right) / 2
  const centerFixedX = (fixed.left + fixed.right) / 2
  const centerMovableY = (movable.top + movable.bottom) / 2
  const centerFixedY = (fixed.top + fixed.bottom) / 2
  // 沿侵入较浅的轴移动量更小，优先；同轴向先推远离对方中心的一侧
  const axes: Array<PushCandidate['axis']> = overlapX <= overlapY ? ['x', 'y'] : ['y', 'x']
  const result: PushCandidate[] = []
  for (const axis of axes) {
    const distance = axis === 'x' ? overlapX : overlapY
    const away: PushCandidate['direction'] = axis === 'x'
      ? (centerMovableX >= centerFixedX ? 1 : -1)
      : (centerMovableY >= centerFixedY ? 1 : -1)
    for (const direction of [away, (away * -1) as PushCandidate['direction']]) {
      if (axis === 'x') {
        const nextLeft = movable.left + direction * distance
        if (nextLeft >= -EPS && nextLeft + movable.width <= deskWidth + EPS) result.push({ axis, direction, distance })
      } else {
        const nextTop = movable.top + direction * distance
        if (nextTop >= -EPS && nextTop + movable.height <= deskHeight + EPS) result.push({ axis, direction, distance })
      }
    }
  }
  return result
}

/** 模拟把某件设备平移 (dx, dy) 后的总重叠对数，不修改真实布局 */
function countPairsAfterMove(plan: WorkspacePlan, movedItem: DeskItem, dx: number, dy: number): number {
  const movedBounds: ItemBounds = { ...getItemBounds(movedItem) }
  movedBounds.left += dx
  movedBounds.right += dx
  movedBounds.top += dy
  movedBounds.bottom += dy
  let count = 0
  for (const other of plan.items) {
    if (other.id === movedItem.id) continue
    if (rectanglesOverlap(movedBounds, getItemBounds(other))) count += 1
  }
  for (let i = 0; i < plan.items.length; i += 1) {
    for (let j = i + 1; j < plan.items.length; j += 1) {
      if (plan.items[i].id === movedItem.id || plan.items[j].id === movedItem.id) continue
      if (rectanglesOverlap(getItemBounds(plan.items[i]), getItemBounds(plan.items[j]))) count += 1
    }
  }
  return count
}

export interface RepairOptions {
  /** 限定只修复这一件设备（只会移动它）；不传则修复整局 */
  scopeItemId?: string
}

export function repairLayout(planInput: WorkspacePlan, options: RepairOptions = {}): RepairReport {
  const scopeItemId = options.scopeItemId ?? null
  const inScope = (id: string) => scopeItemId === null || id === scopeItemId
  const before = analyzeLayout(planInput)
  const items = cloneItems(planInput.items)
  const plan: WorkspacePlan = { ...planInput, items }
  const actions: RepairAction[] = []
  const byId = new Map(items.map((item) => [item.id, item]))

  const recordMove = (item: DeskItem, x: number, y: number, kind: RepairKind) => {
    const distanceMm = Math.hypot(x - item.x, y - item.y)
    if (distanceMm < EPS) return
    item.x = x
    item.y = y
    actions.push({ kind, itemId: item.id, x, y, distanceMm })
  }

  // 第一轮：越界设备沿越出方向推回桌面
  for (const violation of before.boundsViolations) {
    if (!inScope(violation.itemId)) continue
    const item = byId.get(violation.itemId)
    if (!item) continue
    const action = clampIntoDesk(item, plan)
    if (action) recordMove(item, action.x, action.y, 'bounds')
  }

  // 第二轮：逐个消解重叠。每对只移动其中一件，模拟沿浅轴/深轴、正反方向的移动，
  // 用“残留重叠数 + 越界惩罚 + 移动量”打分，允许把冲突沿设备链临时传递；
  // 若所有候选都回到见过的布局且冲突不减少，说明原地打转，则把这对标记阻塞，
  // 最后按“修不动”如实汇报。
  let guard = 0
  const maxIterations = items.length * items.length * 8 + 32
  const blockedPairs = new Set<string>()
  const pairKey = (a: string, b: string) => [a, b].sort().join('|')
  const stateSignature = () => items.map((item) => `${item.id}:${Math.round(item.x)},${Math.round(item.y)}`).join('|')
  const seenStates = new Set<string>([stateSignature()])

  while (guard < maxIterations) {
    guard += 1
    const analysis = analyzeLayout(plan)
    const target = analysis.overlapPairs.find((entry) => {
      if (blockedPairs.has(pairKey(entry.itemIds[0], entry.itemIds[1]))) return false
      return scopeItemId === null || entry.itemIds.includes(scopeItemId)
    })
    if (!target) break

    const [firstId, secondId] = target.itemIds
    const first = byId.get(firstId)
    const second = byId.get(secondId)
    if (!first || !second) {
      blockedPairs.add(pairKey(firstId, secondId))
      continue
    }
    if (!rectanglesOverlap(getItemBounds(first), getItemBounds(second))) continue

    interface Choice { item: DeskItem; candidate: PushCandidate; totalPairs: number; signature: string }
    const choices: Choice[] = []
    const movableItems = scopeItemId === null ? [first, second] : [byId.get(scopeItemId)].filter((entry): entry is DeskItem => Boolean(entry && (entry.id === firstId || entry.id === secondId)))
    for (const movable of movableItems) {
      const fixed = movable.id === firstId ? second : first
      const movableBounds = getItemBounds(movable)
      for (const candidate of feasiblePushes(movableBounds, getItemBounds(fixed), plan.deskWidthMm, plan.deskHeightMm)) {
        const dx = candidate.axis === 'x' ? candidate.direction * candidate.distance : 0
        const dy = candidate.axis === 'y' ? candidate.direction * candidate.distance : 0
        const totalPairs = countPairsAfterMove(plan, movable, dx, dy)
        const movedLeft = movableBounds.left + dx
        const movedTop = movableBounds.top + dy
        const outOfBounds = Math.max(0, -movedLeft) + Math.max(0, -movedTop)
          + Math.max(0, movedLeft + movableBounds.width - plan.deskWidthMm)
          + Math.max(0, movedTop + movableBounds.height - plan.deskHeightMm)
        // 候选只在轴向上选择分离距离：
        //  - 目标对必须真的分开（movedBounds 不再压 fixed）；
        //  - 必须留在桌面内（越界量为 0）；
        //  - 其余条件相同时，优先残留重叠对更少、没走过的布局、移动量更小。
        const movedBoundsCheck: ItemBounds = {
          left: movableBounds.left + dx,
          top: movableBounds.top + dy,
          right: movableBounds.right + dx,
          bottom: movableBounds.bottom + dy,
          width: movableBounds.width,
          height: movableBounds.height,
        }
        const separatesTarget = !rectanglesOverlap(movedBoundsCheck, getItemBounds(fixed))
        const signature = items.map((entry) => {
          if (entry.id !== movable.id) return `${entry.id}:${Math.round(entry.x)},${Math.round(entry.y)}`
          return `${entry.id}:${Math.round(entry.x + dx)},${Math.round(entry.y + dy)}`
        }).join('|')
        if (!separatesTarget || outOfBounds > EPS) continue
        choices.push({ item: movable, candidate, totalPairs, signature })
      }
    }

    // 排序：残留冲突少 → 优先未见过的布局（利于把冲突沿链条推出）→ 移动量小
    const currentPairCount = analysis.overlapPairs.length
    choices.sort((a, b) => {
      if (a.totalPairs !== b.totalPairs) return a.totalPairs - b.totalPairs
      const aSeen = seenStates.has(a.signature) ? 1 : 0
      const bSeen = seenStates.has(b.signature) ? 1 : 0
      if (aSeen !== bSeen && (a.totalPairs < currentPairCount || b.totalPairs < currentPairCount)) return aSeen - bSeen
      return a.candidate.distance - b.candidate.distance
    })
    const pick = choices[0]

    // 没有任何能分开且不出界的方向 → 这对当前无解
    if (!pick) {
      blockedPairs.add(pairKey(firstId, secondId))
      continue
    }
    const revisiting = seenStates.has(pick.signature)
    if (revisiting && pick.totalPairs >= currentPairCount) {
      blockedPairs.add(pairKey(firstId, secondId))
      continue
    }

    const { item, candidate } = pick
    const nextX = item.x + (candidate.axis === 'x' ? candidate.direction * candidate.distance : 0)
    const nextY = item.y + (candidate.axis === 'y' ? candidate.direction * candidate.distance : 0)
    recordMove(item, nextX, nextY, 'overlap')
    seenStates.add(stateSignature())
  }

  // 分离过程中理论上不会推出边界，这里再兜一次底，并如实复查
  const recheck = analyzeLayout(plan)
  for (const violation of recheck.boundsViolations) {
    if (!inScope(violation.itemId)) continue
    const item = byId.get(violation.itemId)
    if (!item) continue
    const action = clampIntoDesk(item, plan)
    if (action) recordMove(item, action.x, action.y, 'bounds')
  }

  const after = analyzeLayout(plan)
  const remainingOverlapItemIds = scopeItemId === null
    ? [...new Set(after.overlapPairs.flatMap((entry) => entry.itemIds))]
    : (after.overlapPairs.some((entry) => entry.itemIds.includes(scopeItemId)) ? [scopeItemId] : [])
  const remainingOutOfBoundsItemIds = scopeItemId === null
    ? after.outOfBoundsIds
    : (after.outOfBoundsIds.includes(scopeItemId) ? [scopeItemId] : [])
  const allReasons = buildReasons(plan, after)
  // 单件修复只报告这件设备自身的原因；其他设备未被处理，不在这里假装解释
  const reasons: Record<string, string> = scopeItemId === null
    ? allReasons
    : (allReasons[scopeItemId] ? { [scopeItemId]: allReasons[scopeItemId] } : {})
  const itemStillBad = scopeItemId !== null
    && (remainingOverlapItemIds.includes(scopeItemId) || remainingOutOfBoundsItemIds.includes(scopeItemId))
  const ok = scopeItemId === null ? after.status === 'clear' : !itemStillBad

  return {
    plan,
    actions,
    before,
    after,
    scopeItemId,
    remainingOverlapItemIds,
    remainingOutOfBoundsItemIds,
    reasons,
    ok,
  }
}

/** 设备比桌面还大，或四边都被挡住时，平移无法解决问题，需要说明真实原因 */
function buildReasons(plan: WorkspacePlan, analysis: LayoutAnalysis): Record<string, string> {
  const reasons: Record<string, string> = {}
  for (const violation of analysis.boundsViolations) {
    const item = plan.items.find((entry) => entry.id === violation.itemId)
    if (!item) continue
    const bounds = getItemBounds(item)
    if (bounds.width > plan.deskWidthMm + EPS || bounds.height > plan.deskHeightMm + EPS) {
      reasons[item.id] = `设备占地 ${Math.round(bounds.width)} × ${Math.round(bounds.height)} mm，比桌面 ${plan.deskWidthMm} × ${plan.deskHeightMm} mm 还大，平移放不下，请先缩小设备或加大桌面`
    } else {
      reasons[item.id] = '推回后仍越界，可能被相邻设备挡住，请手动调整'
    }
  }
  const blockedPairs = analysis.overlapPairs.map((entry) => entry.itemIds)
  for (const [idA, idB] of blockedPairs) {
    for (const id of [idA, idB]) {
      if (reasons[id]) continue
      const item = plan.items.find((entry) => entry.id === id)
      if (!item) continue
      const bounds = getItemBounds(item)
      if (bounds.width > plan.deskWidthMm + EPS || bounds.height > plan.deskHeightMm + EPS) {
        reasons[id] = '设备比桌面还大，无法在桌面内与其他设备分开，请先缩小设备或加大桌面'
      } else {
        reasons[id] = '四周都被桌面边界或其他设备挡住，找不到不越界的移动方向，请手动调整或加大桌面'
      }
    }
  }
  return reasons
}
