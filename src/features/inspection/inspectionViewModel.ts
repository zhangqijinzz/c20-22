import { analyzeLayout } from '../../shared/layoutRules'
import type { IssueEntry, LayoutAnalysis, WorkspacePlan } from '../../shared/models'

export interface InspectionState {
  analysis: LayoutAnalysis
  entries: IssueEntry[]
  issueIds: string[]
  issueCount: number
}

export function inspectPlan(plan: WorkspacePlan): InspectionState {
  const analysis = analyzeLayout(plan)
  const issueIds = [...new Set([...analysis.overlapIds, ...analysis.outOfBoundsIds])]
  return { analysis, entries: analysis.entries, issueIds, issueCount: issueIds.length }
}
