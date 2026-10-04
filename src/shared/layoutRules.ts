import type { BoundsViolation, DeskItem, ItemBounds, LayoutAnalysis, OverlapPair, WorkspacePlan } from './models'

/** 设备之间允许的最小安全间距（mm） */
export const GAP_MM = 2

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

export function analyzeLayout(plan: WorkspacePlan): LayoutAnalysis {
  const overlapIds = new Set<string>()
  const outOfBoundsIds = new Set<string>()
  const boundsViolations: BoundsViolation[] = []
  const overlapPairs: OverlapPair[] = []
  const bounds = new Map(plan.items.map((item) => [item.id, getItemBounds(item)]))

  plan.items.forEach((item) => {
    const itemBounds = bounds.get(item.id)
    if (!itemBounds) return
    const overflows: BoundsViolation['overflows'] = []
    if (itemBounds.left < 0) overflows.push({ edge: 'left', amountMm: -itemBounds.left })
    if (itemBounds.top < 0) overflows.push({ edge: 'top', amountMm: -itemBounds.top })
    if (itemBounds.right > plan.deskWidthMm) overflows.push({ edge: 'right', amountMm: itemBounds.right - plan.deskWidthMm })
    if (itemBounds.bottom > plan.deskHeightMm) overflows.push({ edge: 'bottom', amountMm: itemBounds.bottom - plan.deskHeightMm })
    if (overflows.length > 0) {
      outOfBoundsIds.add(item.id)
      boundsViolations.push({ itemId: item.id, overflows, totalMm: overflows.reduce((sum, overflow) => sum + overflow.amountMm, 0) })
    }
  })

  for (let index = 0; index < plan.items.length; index += 1) {
    for (let nextIndex = index + 1; nextIndex < plan.items.length; nextIndex += 1) {
      const first = plan.items[index]
      const second = plan.items[nextIndex]
      const firstBounds = bounds.get(first.id)
      const secondBounds = bounds.get(second.id)
      if (firstBounds && secondBounds && rectanglesOverlap(firstBounds, secondBounds)) {
        overlapIds.add(first.id)
        overlapIds.add(second.id)
        const gapX = Math.min(firstBounds.right, secondBounds.right) - Math.max(firstBounds.left, secondBounds.left)
        const gapY = Math.min(firstBounds.bottom, secondBounds.bottom) - Math.max(firstBounds.top, secondBounds.top)
        // 最小平移向量取侵入较浅的轴向，再留 GAP_MM 的安全间距
        const depthMm = Math.min(gapX, gapY) + GAP_MM
        overlapPairs.push({ itemIds: [first.id, second.id], depthMm })
      }
    }
  }

  const occupiedArea = plan.items.reduce((total, item) => total + item.widthMm * item.heightMm, 0)
  const deskArea = plan.deskWidthMm * plan.deskHeightMm
  const coveragePercent = Math.min(100, Math.round((occupiedArea / deskArea) * 100))
  const hasIssue = overlapIds.size > 0 || outOfBoundsIds.size > 0
  return {
    overlapIds: [...overlapIds],
    outOfBoundsIds: [...outOfBoundsIds],
    boundsViolations,
    overlapPairs,
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
