import { AlertTriangle, ArrowRight, CheckCircle2, Layers, LogOut, Wand2, X } from 'lucide-react'
import type { IssueDetail } from '../inspectionViewModel'
import type { RepairSummary } from '../../workbench/workbenchViewModel'
import { getDeviceDefinition, type WorkspacePlan } from '../../../shared/models'

interface IssueReportProps {
  plan: WorkspacePlan
  issues: IssueDetail[]
  selectedItemId: string | null
  repairSummary: RepairSummary | null
  onSelectItem: (id: string) => void
  onRepairAll: () => void
  onRepairItem: (id: string) => void
  onDismissSummary: () => void
}

const EDGE_LABELS: Record<'left' | 'top' | 'right' | 'bottom', string> = {
  left: '左边界',
  top: '上边界',
  right: '右边界',
  bottom: '下边界',
}

function formatMm(value: number): string {
  return `${Math.round(value)} mm`
}

export function IssueReport({ plan, issues, selectedItemId, repairSummary, onSelectItem, onRepairAll, onRepairItem, onDismissSummary }: IssueReportProps) {
  return (
    <section className="issue-report" aria-labelledby="issue-report-title">
      <div className="issue-report-heading">
        <div>
          <span className="eyebrow">CHECK RESULT</span>
          <h3 id="issue-report-title">检查明细</h3>
        </div>
        {issues.length > 0
          ? <button className="repair-all-button" type="button" onClick={onRepairAll}><Wand2 size={13} /> 一键修复全部</button>
          : <span className="report-clear-badge"><CheckCircle2 size={13} /> 已通过</span>}
      </div>

      {repairSummary && <RepairSummaryCard summary={repairSummary} plan={plan} onSelectItem={onSelectItem} onDismiss={onDismissSummary} />}

      {issues.length === 0 ? (
        <p className="report-empty"><CheckCircle2 size={15} /> 所有设备都在桌面内，且互不重叠。</p>
      ) : (
        <ul className="issue-list">
          {issues.map((issue) => {
            const item = plan.items.find((entry) => entry.id === issue.itemId)
            if (!item) return null
            const definition = getDeviceDefinition(item.type)
            const isSelected = selectedItemId === issue.itemId
            return (
              <li className={`issue-row ${isSelected ? 'is-active' : ''}`} key={issue.itemId}>
                <button className="issue-row-main" type="button" onClick={() => onSelectItem(issue.itemId)}>
                  <span className="issue-swatch" style={{ backgroundColor: definition.color }} />
                  <span className="issue-copy">
                    <strong>{definition.label}</strong>
                    <span className="issue-reasons">
                      {issue.overflows.length > 0 && (
                        <span className="reason-tag out-tag"><LogOut size={11} /> 超出{issue.overflows.map((overflow) => EDGE_LABELS[overflow.edge]).join('、')} · 最多 {formatMm(Math.max(...issue.overflows.map((overflow) => overflow.amountMm)))}</span>
                      )}
                      {issue.overlaps.map((overlap) => {
                        const other = plan.items.find((entry) => entry.id === overlap.otherItemId)
                        const otherLabel = other ? getDeviceDefinition(other.type).label : '另一设备'
                        return <span className="reason-tag overlap-tag" key={overlap.otherItemId}><Layers size={11} /> 压住{otherLabel} · 最小移开 {formatMm(overlap.depthMm)}</span>
                      })}
                    </span>
                  </span>
                </button>
                <button className="issue-fix-button" type="button" onClick={() => onRepairItem(issue.itemId)} aria-label={`自动修复${definition.label}`} title="按最小移动量自动修复这一件">
                  <Wand2 size={13} /><span>修复</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {issues.length > 0 && <p className="report-hint">点条目可选中画布上的设备；修复后会自动重新检查并汇报本轮改动。</p>}
    </section>
  )
}

function RepairSummaryCard({ summary, plan, onSelectItem, onDismiss }: { summary: RepairSummary; plan: WorkspacePlan; onSelectItem: (id: string) => void; onDismiss: () => void }) {
  return (
    <div className={`repair-card ${summary.ok ? 'repair-ok' : 'repair-bad'} ${summary.stale ? 'is-stale' : ''}`}>
      <header className="repair-card-head">
        <span className="repair-card-title">
          {summary.ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
          {summary.stale ? '修复报告已过期' : summary.ok ? '修复完成 · 复查通过' : '修复后复查仍有问题'}
        </span>
        <button className="repair-card-close" type="button" aria-label="关闭修复报告" onClick={onDismiss}><X size={12} /></button>
      </header>

      {!summary.stale && (
        <>
          <p className="repair-count-line">
            问题 <strong>{summary.issueCountBefore}</strong> → <strong>{summary.issueCountAfter}</strong>
            <i>；</i>共移动 <strong>{summary.movedCount}</strong> 件设备
            {summary.scopeItemId && <i>（单件修复）</i>}
          </p>
          {summary.changes.length > 0 && (
            <ul className="repair-change-list">
              {summary.changes.map((change) => (
                <li key={change.itemId}>
                  <button type="button" className="repair-change-row" onClick={() => onSelectItem(change.itemId)}>
                    <span className="change-kind">{change.kind === 'bounds' ? '推回桌面' : '分开重叠'}</span>
                    <span className="change-label">{change.label}</span>
                    <span className="change-move">
                      ({Math.round(change.fromX)}, {Math.round(change.fromY)})
                      <ArrowRight size={11} />
                      ({Math.round(change.toX)}, {Math.round(change.toY)})
                      <em>累计 {formatMm(change.distanceMm)}</em>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {summary.changes.length === 0 && <p className="repair-no-move">这一轮没有执行任何移动。</p>}
          {!summary.ok && summary.remainingReasons.length > 0 && (
            <ul className="repair-reason-list">
              {summary.remainingReasons.map((entry) => {
                const item = plan.items.find((candidate) => candidate.id === entry.itemId)
                const label = item ? getDeviceDefinition(item.type).label : entry.label
                return (
                  <li key={entry.itemId}>
                    <button type="button" className="repair-reason-row" onClick={() => onSelectItem(entry.itemId)}>
                      <AlertTriangle size={12} />
                      <span><strong>{label}：</strong>{entry.reason}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
      {summary.stale && <p className="repair-stale-line">报告生成后你又手动改动过布局，请以最新检查明细为准。</p>}
    </div>
  )
}
