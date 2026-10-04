import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createId,
  createInitialDocument,
  createPlan,
  type DeskItem,
  type DeviceType,
  type LayoutAnalysis,
  type WorkspaceDocument,
  type WorkspacePlan,
  type WorkspaceStatus,
} from '../../shared/models'
import { clampDeskSize, clampItemDimension } from '../../shared/layoutRules'
import { getDeviceDefinition } from '../../shared/models'
import { moveCanvasItem, rotateCanvasItem } from '../canvas/canvasViewModel'
import { createMaterialDraft } from '../materials/materialsViewModel'
import { inspectPlan, type IssueDetail } from '../inspection/inspectionViewModel'
import { repairLayout, type RepairAction, type RepairReport } from '../inspection/repairEngine'
import { LocalWorkspaceRepository, type WorkspaceRepository } from './workspaceRepository'

export interface ItemChangeSummary {
  itemId: string
  label: string
  distanceMm: number
  kind: RepairAction['kind']
  /** 最终相对原位置的累计位移（mm） */
  fromX: number
  fromY: number
  toX: number
  toY: number
}

export interface RepairSummary {
  scopeItemId: string | null
  ok: boolean
  movedCount: number
  /** 修复前问题数（单件修复时为该设备相关问题：重叠邻居数 + 是否越界） */
  issueCountBefore: number
  issueCountAfter: number
  changes: ItemChangeSummary[]
  remainingReasons: Array<{ itemId: string; label: string; reason: string }>
  /** 用户在修复之后又手动改动过布局，报告已过期 */
  stale: boolean
}

export interface WorkspaceViewModel {
  status: WorkspaceStatus
  document: WorkspaceDocument | null
  activePlan: WorkspacePlan | null
  selectedItem: DeskItem | null
  analysis: LayoutAnalysis
  issues: IssueDetail[]
  issueIds: string[]
  issueCount: number
  feedback: string
  isPreviewOpen: boolean
  selectItem: (id: string | null) => void
  addItem: (type: DeviceType) => void
  removeItem: (id: string) => void
  moveItem: (id: string, x: number, y: number) => void
  rotateItem: (id: string, delta: number) => void
  updateItem: (id: string, patch: Partial<Pick<DeskItem, 'widthMm' | 'heightMm' | 'x' | 'y'>>) => void
  updateDesk: (field: 'deskWidthMm' | 'deskHeightMm', value: number) => void
  createNewPlan: () => void
  duplicatePlan: () => void
  selectPlan: (id: string) => void
  deleteCurrentPlan: () => void
  openPreview: () => void
  closePreview: () => void
  repairAll: () => void
  repairItem: (id: string) => void
  dismissRepairSummary: () => void
  repairSummary: RepairSummary | null
}

const emptyInspection = { analysis: { overlapIds: [], outOfBoundsIds: [], boundsViolations: [], overlapPairs: [], coveragePercent: 0, status: 'clear' as const }, issues: [], issueIds: [], issueCount: 0 }

/** 单件视角的问题数：越界算 1 件事，重叠按压住的邻居计数 */
function issueCountForItem(analysis: LayoutAnalysis, itemId: string): number {
  let count = analysis.outOfBoundsIds.includes(itemId) ? 1 : 0
  count += analysis.overlapPairs.filter((pair) => pair.itemIds.includes(itemId)).length
  return count
}

export function useWorkspaceViewModel(repository?: WorkspaceRepository): WorkspaceViewModel {
  const repositoryRef = useRef(repository ?? new LocalWorkspaceRepository())
  const [status, setStatus] = useState<WorkspaceStatus>('loading')
  const [document, setDocument] = useState<WorkspaceDocument | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [repairSummary, setRepairSummary] = useState<RepairSummary | null>(null)
  const [feedback, setFeedback] = useState('正在准备你的工作台…')

  useEffect(() => {
    let active = true
    void repositoryRef.current.load().then((loaded) => {
      if (!active) return
      const nextDocument = loaded ?? createInitialDocument()
      setDocument(nextDocument)
      setStatus('ready')
      setFeedback(loaded ? '已恢复上次编辑状态' : '已创建示例工作台，可以直接拖动设备')
    }).catch(() => {
      if (!active) return
      setDocument(createInitialDocument())
      setStatus('error')
      setFeedback('本地数据读取失败，当前使用临时工作台')
    })
    return () => { active = false }
  }, [])

  const activePlan = useMemo(
    () => document?.plans.find((plan) => plan.id === document.activePlanId) ?? null,
    [document],
  )
  const selectedItem = activePlan?.items.find((item) => item.id === selectedItemId) ?? null
  const inspection = useMemo(() => activePlan ? inspectPlan(activePlan) : emptyInspection, [activePlan])
  const { analysis, issueIds, issueCount } = inspection

  const persist = useCallback(async (nextDocument: WorkspaceDocument, message: string) => {
    setDocument(nextDocument)
    setStatus('saving')
    setFeedback(message)
    try {
      await repositoryRef.current.save(nextDocument)
      setStatus('ready')
    } catch {
      setStatus('error')
      setFeedback('自动保存失败，请检查浏览器本地存储权限')
    }
  }, [])

  const updateActivePlan = useCallback((updater: (plan: WorkspacePlan) => WorkspacePlan, message: string) => {
    if (!document || !activePlan) return
    // 用户手动改动后，上一轮自动修复报告不再对应当前布局
    setRepairSummary((current) => current && !current.stale ? { ...current, stale: true } : current)
    const nextPlan = { ...updater(activePlan), updatedAt: new Date().toISOString() }
    const nextDocument = { ...document, plans: document.plans.map((plan) => plan.id === nextPlan.id ? nextPlan : plan) }
    void persist(nextDocument, message)
  }, [activePlan, document, persist])

  const selectItem = useCallback((id: string | null) => setSelectedItemId(id), [])

  const addItem = useCallback((type: DeviceType) => {
    if (!activePlan) return
    const draft = createMaterialDraft(type, activePlan.items.length)
    updateActivePlan((plan) => ({ ...plan, items: [...plan.items, draft.item] }), draft.feedback)
    setSelectedItemId(draft.item.id)
  }, [activePlan, updateActivePlan])

  const removeItem = useCallback((id: string) => {
    updateActivePlan((plan) => ({ ...plan, items: plan.items.filter((item) => item.id !== id) }), '设备已移除')
    setSelectedItemId((current) => current === id ? null : current)
  }, [updateActivePlan])

  const moveItem = useCallback((id: string, x: number, y: number) => {
    updateActivePlan((plan) => ({ ...plan, items: moveCanvasItem(plan.items, id, x, y) }), '位置已更新')
  }, [updateActivePlan])

  const rotateItem = useCallback((id: string, delta: number) => {
    updateActivePlan((plan) => ({ ...plan, items: rotateCanvasItem(plan.items, id, delta) }), '角度已更新')
  }, [updateActivePlan])

  const updateItem = useCallback((id: string, patch: Partial<Pick<DeskItem, 'widthMm' | 'heightMm' | 'x' | 'y'>>) => {
    updateActivePlan((plan) => ({
      ...plan,
      items: plan.items.map((item) => item.id === id ? {
        ...item,
        ...patch,
        widthMm: patch.widthMm === undefined ? item.widthMm : clampItemDimension(patch.widthMm, item.widthMm),
        heightMm: patch.heightMm === undefined ? item.heightMm : clampItemDimension(patch.heightMm, item.heightMm),
      } : item),
    }), '尺寸参数已更新')
  }, [updateActivePlan])

  const updateDesk = useCallback((field: 'deskWidthMm' | 'deskHeightMm', value: number) => {
    if (!activePlan) return
    updateActivePlan((plan) => ({ ...plan, [field]: clampDeskSize(value, plan[field]) }), '桌面尺寸已更新')
  }, [activePlan, updateActivePlan])

  const createNewPlan = useCallback(() => {
    if (!document) return
    const plan = createPlan(`工作台 ${document.plans.length + 1}`, false)
    void persist({ ...document, plans: [...document.plans, plan], activePlanId: plan.id }, '已创建空白方案')
    setSelectedItemId(null)
    setRepairSummary(null)
  }, [document, persist])

  const duplicatePlan = useCallback(() => {
    if (!document || !activePlan) return
    const copy: WorkspacePlan = {
      ...activePlan,
      id: createId('plan'),
      name: `${activePlan.name} · 副本`,
      items: activePlan.items.map((item) => ({ ...item, id: createId('item') })),
      updatedAt: new Date().toISOString(),
    }
    void persist({ ...document, plans: [...document.plans, copy], activePlanId: copy.id }, '方案已复制')
    setSelectedItemId(null)
    setRepairSummary(null)
  }, [activePlan, document, persist])

  const selectPlan = useCallback((id: string) => {
    if (!document || !document.plans.some((plan) => plan.id === id)) return
    void persist({ ...document, activePlanId: id }, '已切换方案')
    setSelectedItemId(null)
    setRepairSummary(null)
  }, [document, persist])

  const deleteCurrentPlan = useCallback(() => {
    if (!document || !activePlan || document.plans.length <= 1) {
      setFeedback('至少保留一个工作台方案')
      return
    }
    const remaining = document.plans.filter((plan) => plan.id !== activePlan.id)
    void persist({ ...document, plans: remaining, activePlanId: remaining[0].id }, '方案已删除')
    setSelectedItemId(null)
    setRepairSummary(null)
  }, [activePlan, document, persist])

  const openPreview = useCallback(() => setIsPreviewOpen(true), [])
  const closePreview = useCallback(() => setIsPreviewOpen(false), [])

  const buildSummary = useCallback((report: RepairReport, originalPlan: WorkspacePlan): RepairSummary => {
    const labelOf = (id: string) => {
      const found = originalPlan.items.find((item) => item.id === id)
        ?? report.plan.items.find((item) => item.id === id)
      return found ? getDeviceDefinition(found.type).label : '已移除的设备'
    }
    // 同一件设备可能被连续推动多步，按最终落点与原始位置汇总
    const byItem = new Map<string, { first: RepairAction; last: RepairAction; total: number }>()
    for (const action of report.actions) {
      const entry = byItem.get(action.itemId)
      if (entry) {
        entry.last = action
        entry.total += action.distanceMm
      } else {
        byItem.set(action.itemId, { first: action, last: action, total: action.distanceMm })
      }
    }
    const changes: ItemChangeSummary[] = [...byItem.entries()].map(([itemId, entry]) => {
      const origin = originalPlan.items.find((item) => item.id === itemId)
      return {
        itemId,
        label: labelOf(itemId),
        distanceMm: entry.total,
        kind: entry.last.kind,
        fromX: origin?.x ?? entry.first.x,
        fromY: origin?.y ?? entry.first.y,
        toX: entry.last.x,
        toY: entry.last.y,
      }
    })

    const issueCount = (plan: WorkspacePlan) => inspectPlan(plan).issueCount
    const remainingReasons = Object.entries(report.reasons).map(([itemId, reason]) => ({ itemId, label: labelOf(itemId), reason }))

    return {
      scopeItemId: report.scopeItemId,
      ok: report.ok,
      movedCount: changes.length,
      issueCountBefore: report.scopeItemId
        ? issueCountForItem(report.before, report.scopeItemId)
        : issueCount(originalPlan),
      issueCountAfter: report.scopeItemId
        ? issueCountForItem(report.after, report.scopeItemId)
        : issueCount(report.plan),
      changes,
      remainingReasons,
      stale: false,
    }
  }, [])

  const applyRepair = useCallback((scopeItemId?: string) => {
    if (!document || !activePlan) return
    const report = repairLayout(activePlan, scopeItemId ? { scopeItemId } : {})
    const summary = buildSummary(report, activePlan)
    if (report.actions.length === 0) {
      // 没动任何东西也要说实话：要么本来就没问题，要么确实推不动
      setRepairSummary(summary)
      setFeedback(summary.ok ? '检查通过，没有需要修复的问题' : '没有可执行的移动，仍有问题未解决')
      return
    }
    const nextPlan = { ...report.plan, updatedAt: new Date().toISOString() }
    const nextDocument = { ...document, plans: document.plans.map((plan) => plan.id === nextPlan.id ? nextPlan : plan) }
    setRepairSummary(summary)
    if (scopeItemId) setSelectedItemId(scopeItemId)
    void persist(nextDocument, summary.ok
      ? (scopeItemId ? '该设备已自动修复并复查通过' : '全部问题已修复，复查通过')
      : '已执行可做的移动，但复查仍有问题')
  }, [activePlan, buildSummary, document, persist])

  const repairAll = useCallback(() => applyRepair(), [applyRepair])
  const repairItem = useCallback((id: string) => applyRepair(id), [applyRepair])
  const dismissRepairSummary = useCallback(() => setRepairSummary(null), [])

  return {
    status,
    document,
    activePlan,
    selectedItem,
    analysis,
    issues: inspection.issues,
    issueIds,
    issueCount,
    feedback,
    isPreviewOpen,
    selectItem,
    addItem,
    removeItem,
    moveItem,
    rotateItem,
    updateItem,
    updateDesk,
    createNewPlan,
    duplicatePlan,
    selectPlan,
    deleteCurrentPlan,
    openPreview,
    closePreview,
    repairAll,
    repairItem,
    dismissRepairSummary,
    repairSummary,
  }
}
