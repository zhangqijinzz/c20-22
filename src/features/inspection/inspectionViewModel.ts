import { analyzeLayout } from '../../shared/layoutRules'
import type { BoundsViolation, LayoutAnalysis, OverlapPair, WorkspacePlan } from '../../shared/models'

export type IssueKind = 'overlap' | 'outOfBounds' | 'both'

export interface OverlapDetail {
  /** 被压住的另一件设备 id */
  otherItemId: string
  /** 按最小平移量分开需要移动的距离（mm） */
  depthMm: number
}

export interface IssueDetail {
  itemId: string
  kind: IssueKind
  /** 与这件设备重叠的其他设备 */
  overlaps: OverlapDetail[]
  /** 超出桌面的各条边及越界量（mm） */
  overflows: BoundsViolation['overflows']
  totalOverflowMm: number
}

export interface InspectionState {
  analysis: LayoutAnalysis
  issues: IssueDetail[]
  issueIds: string[]
  issueCount: number
}

export function inspectPlan(plan: WorkspacePlan): InspectionState {
  const analysis = analyzeLayout(plan)
  const violationById = new Map(analysis.boundsViolations.map((violation) => [violation.itemId, violation]))
  const overlapsByItem = new Map<string, OverlapDetail[]>()

  const addOverlap = (itemId: string, otherItemId: string, pair: OverlapPair) => {
    const list = overlapsByItem.get(itemId) ?? []
    list.push({ otherItemId, depthMm: pair.depthMm })
    overlapsByItem.set(itemId, list)
  }

  for (const pair of analysis.overlapPairs) {
    addOverlap(pair.itemIds[0], pair.itemIds[1], pair)
    addOverlap(pair.itemIds[1], pair.itemIds[0], pair)
  }

  const issueIds = [...new Set([...analysis.overlapIds, ...analysis.outOfBoundsIds])]
  // 按设备在画布上的顺序出明细，方便用户对照
  const issues: IssueDetail[] = plan.items
    .filter((item) => issueIds.includes(item.id))
    .map((item) => {
      const violation = violationById.get(item.id)
      const overlaps = overlapsByItem.get(item.id) ?? []
      const isOverlap = overlaps.length > 0
      const isOutOfBounds = Boolean(violation)
      return {
        itemId: item.id,
        kind: isOverlap && isOutOfBounds ? 'both' : isOverlap ? 'overlap' : 'outOfBounds',
        overlaps: overlaps.sort((a, b) => b.depthMm - a.depthMm),
        overflows: violation?.overflows ?? [],
        totalOverflowMm: violation?.totalMm ?? 0,
      }
    })

  return { analysis, issues, issueIds, issueCount: issues.length }
}
