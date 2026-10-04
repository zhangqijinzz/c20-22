import type { DeskItem, IssueEntry, ItemBounds, LayoutAnalysis, OverflowDetail, OverlapDetail, WorkspacePlan } from './models'

export function normalizeRotation(rotation: number): number {
  const normalized = rotation % 360
  return normalized < 0 ? normalized + 360 : normalized
}

export function getItemBounds(item: DeskItem): ItemBounds {
  const radians = (normalizeRotation(item.rotation) * Math.PI) / 180
  const width = Math.abs(item.widthMm * Math.cos(radians)) + Math.abs(item.heightMm * Math.sin(radians))
  const height = Math.abs(item.widthMm * Math.sin(radians)) + Math.abs(item.heightMm * Math.cos(radians))
  const centerX = item.x + item.widthMm / 2
  const centerY = item.y + item.heightMm / 2
  return {
    left: centerX - width / 2,
    top: centerY - height / 2,
    right: centerX + width / 2,
    bottom: centerY + height / 2,
    width,
    height,
  }
}

export function rectanglesOverlap(first: ItemBounds, second: ItemBounds): boolean {
  const horizontal = Math.min(first.right, second.right) - Math.max(first.left, second.left)
  const vertical = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top)
  return horizontal > 1 && vertical > 1
}

/** 毫米以下的偏差视为制造容差，不报告为问题 */
export const BOUNDS_TOLERANCE_MM = 0.5

export function analyzeLayout(plan: WorkspacePlan): LayoutAnalysis {
  const bounds = new Map(plan.items.map((item) => [item.id, getItemBounds(item)]))
  const entries = new Map<string, IssueEntry>()

  const entryFor = (item: DeskItem): IssueEntry => {
    let entry = entries.get(item.id)
    if (!entry) {
      entry = { itemId: item.id, itemType: item.type, kinds: [], overlaps: [], overflows: [] }
      entries.set(item.id, entry)
    }
    return entry
  }

  plan.items.forEach((item) => {
    const itemBounds = bounds.get(item.id)
    if (!itemBounds) return
    const overflows: OverflowDetail[] = []
    if (itemBounds.left < -BOUNDS_TOLERANCE_MM) overflows.push({ side: 'left', amountMm: -itemBounds.left })
    if (itemBounds.top < -BOUNDS_TOLERANCE_MM) overflows.push({ side: 'top', amountMm: -itemBounds.top })
    if (itemBounds.right > plan.deskWidthMm + BOUNDS_TOLERANCE_MM) overflows.push({ side: 'right', amountMm: itemBounds.right - plan.deskWidthMm })
    if (itemBounds.bottom > plan.deskHeightMm + BOUNDS_TOLERANCE_MM) overflows.push({ side: 'bottom', amountMm: itemBounds.bottom - plan.deskHeightMm })
    if (overflows.length > 0) {
      const entry = entryFor(item)
      entry.kinds.push('outOfBounds')
      entry.overflows.push(...overflows)
    }
  })

  for (let index = 0; index < plan.items.length; index += 1) {
    for (let nextIndex = index + 1; nextIndex < plan.items.length; nextIndex += 1) {
      const first = plan.items[index]
      const second = plan.items[nextIndex]
      const firstBounds = bounds.get(first.id)
      const secondBounds = bounds.get(second.id)
      if (!firstBounds || !secondBounds || !rectanglesOverlap(firstBounds, secondBounds)) continue
      const overlapX = Math.min(firstBounds.right, secondBounds.right) - Math.max(firstBounds.left, secondBounds.left)
      const overlapY = Math.min(firstBounds.bottom, secondBounds.bottom) - Math.max(firstBounds.top, secondBounds.top)
      const firstEntry = entryFor(first)
      firstEntry.kinds.push('overlap')
      firstEntry.overlaps.push({ otherId: second.id, otherType: second.type, overlapXMm: overlapX, overlapYMm: overlapY })
      const secondEntry = entryFor(second)
      secondEntry.kinds.push('overlap')
      secondEntry.overlaps.push({ otherId: first.id, otherType: first.type, overlapXMm: overlapX, overlapYMm: overlapY })
    }
  }

  const issueSeverity = (entry: IssueEntry): number => Math.max(
    0,
    ...entry.overflows.map((overflow) => overflow.amountMm),
    ...entry.overlaps.map((overlap) => Math.min(overlap.overlapXMm, overlap.overlapYMm)),
  )
  const sortedEntries = [...entries.values()].sort((left, right) => {
    const leftOutOfBounds = left.kinds.includes('outOfBounds') ? 0 : 1
    const rightOutOfBounds = right.kinds.includes('outOfBounds') ? 0 : 1
    if (leftOutOfBounds !== rightOutOfBounds) return leftOutOfBounds - rightOutOfBounds
    return issueSeverity(right) - issueSeverity(left)
  })

  const overlapIds = new Set<string>()
  const outOfBoundsIds = new Set<string>()
  sortedEntries.forEach((entry) => {
    if (entry.kinds.includes('overlap')) overlapIds.add(entry.itemId)
    if (entry.kinds.includes('outOfBounds')) outOfBoundsIds.add(entry.itemId)
  })

  const occupiedArea = plan.items.reduce((total, item) => total + item.widthMm * item.heightMm, 0)
  const deskArea = plan.deskWidthMm * plan.deskHeightMm
  const coveragePercent = Math.min(100, Math.round((occupiedArea / deskArea) * 100))
  const hasIssue = sortedEntries.length > 0
  return {
    overlapIds: [...overlapIds],
    outOfBoundsIds: [...outOfBoundsIds],
    entries: sortedEntries,
    coveragePercent,
    status: hasIssue ? 'attention' : 'clear',
  }
}

export function clampDeskSize(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(4000, Math.max(600, Math.round(value)))
}

export function clampItemDimension(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(2000, Math.max(40, Math.round(value)))
}
