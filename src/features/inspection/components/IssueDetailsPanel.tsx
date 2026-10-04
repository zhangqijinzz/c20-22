import { ArrowDownToLine, ArrowLeftToLine, ArrowRightToLine, ArrowUpToLine, CheckCircle2, CircleCheckBig, ClipboardList, Layers, TriangleAlert, Wand2, X } from 'lucide-react'
import type { IssueEntry, OverflowSide } from '../../../shared/models'
import { getDeviceDefinition } from '../../../shared/models'
import type { FixRoundReport } from '../inspectionReport'

interface IssueDetailsPanelProps {
  entries: IssueEntry[]
  selectedItemId: string | null
  fixReport: FixRoundReport | null
  onSelect: (id: string) => void
  onFixItem: (id: string) => void
  onFixAll: () => void
  onDismissReport: () => void
}

const OVERFLOW_LABELS: Record<OverflowSide, { text: string; icon: typeof ArrowUpToLine }> = {
  left: { text: '左边缘越出', icon: ArrowLeftToLine },
  top: { text: '上边缘越出', icon: ArrowUpToLine },
  right: { text: '右边缘越出', icon: ArrowRightToLine },
  bottom: { text: '下边缘越出', icon: ArrowDownToLine },
}

function wholeMm(value: number): number {
  return Math.max(1, Math.round(value))
}

function IssueRow({ entry, isSelected, onSelect, onFix }: { entry: IssueEntry; isSelected: boolean; onSelect: () => void; onFix: () => void }) {
  const definition = getDeviceDefinition(entry.itemType)
  const isOverlap = entry.kinds.includes('overlap')
  const isOutOfBounds = entry.kinds.includes('outOfBounds')
  const fixLabel = isOutOfBounds && isOverlap ? '推回并分开' : isOutOfBounds ? '推回桌面' : '一键分开'
  return (
    <li className={`issue-row ${isSelected ? 'is-selected' : ''}`}>
      <button className="issue-row-main" type="button" onClick={onSelect}>
        <span className="issue-swatch" style={{ backgroundColor: definition.color }} />
        <span className="issue-row-copy">
          <strong>{definition.label}</strong>
          <span className="issue-tags">
            {isOutOfBounds && <em className="issue-tag tag-bounds"><ArrowDownToLine size={10} /> 超出桌面</em>}
            {isOverlap && <em className="issue-tag tag-overlap"><Layers size={10} /> 压住设备</em>}
          </span>
          {entry.overflows.map((overflow, index) => {
            const meta = OVERFLOW_LABELS[overflow.side]
            const Icon = meta.icon
            return <small className="issue-detail-line" key={`${overflow.side}-${index}`}><Icon size={11} /> {meta.text} {wholeMm(overflow.amountMm)} mm</small>
          })}
          {entry.overlaps.map((overlap, index) => (
            <small className="issue-detail-line" key={`${overlap.otherId}-${index}`}>
              <Layers size={11} /> 压住「{getDeviceDefinition(overlap.otherType).label}」，横向叠 {wholeMm(overlap.overlapXMm)} mm、纵向叠 {wholeMm(overlap.overlapYMm)} mm
            </small>
          ))}
        </span>
      </button>
      <button className="issue-fix-button" type="button" onClick={onFix} aria-label={`自动修复${definition.label}`}>{fixLabel}</button>
    </li>
  )
}

function FixReportCard({ report, onSelect, onDismiss }: { report: FixRoundReport; onSelect: (id: string) => void; onDismiss: () => void }) {
  const healthy = report.attemptedCount > 0 && report.remainingCount === 0
  const noChange = !report.changed && report.attemptedCount > 0
  return (
    <section className={`fix-report ${healthy ? 'fix-ok' : report.remainingCount > 0 ? 'fix-warn' : 'fix-idle'}`}>
      <header className="fix-report-header">
        <span className="fix-report-icon">
          {healthy ? <CircleCheckBig size={15} /> : <TriangleAlert size={15} />}
        </span>
        <div>
          <strong>{report.title}</strong>
          <p>{report.detail}</p>
        </div>
        <button className="fix-report-close" type="button" aria-label="收起本轮修复说明" onClick={onDismiss}><X size={13} /></button>
      </header>
      {report.moves.length > 0 && (
        <ul className="fix-move-list">
          {report.moves.map((move) => (
            <li key={move.itemId}>
              <button type="button" onClick={() => onSelect(move.itemId)}>
                <Wand2 size={11} /> <strong>{move.label}</strong>
                <span>{move.deltaText}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {noChange && report.failures.length === 0 && <p className="fix-note">没有产生任何位移，可手动拖动或调整尺寸。</p>}
      {report.failures.length > 0 && (
        <ul className="fix-failure-list">
          {report.failures.map((failure) => (
            <li key={`${failure.itemId}-${failure.reason}`}>
              <button type="button" onClick={() => onSelect(failure.itemId)}>
                <TriangleAlert size={12} />
                <span><strong>{failure.label}：</strong>{failure.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function IssueDetailsPanel({ entries, selectedItemId, fixReport, onSelect, onFixItem, onFixAll, onDismissReport }: IssueDetailsPanelProps) {
  const issueCount = entries.length
  return (
    <section className="issue-panel module-panel" id="issue-details" aria-live="polite">
      <div className="module-heading">
        <div>
          <span className="eyebrow">03 / 检查明细</span>
          <h2>问题清单</h2>
        </div>
        <ClipboardList size={18} className="muted-icon" />
      </div>
      <div className="issue-summary">
        {issueCount > 0 ? (
          <>
            <p className="issue-summary-text"><TriangleAlert size={14} /> 共 <strong>{issueCount}</strong> 件设备需要处理，点击任意一条可在画布上选中它</p>
            <button className="fix-all-button" type="button" onClick={onFixAll}><Wand2 size={14} /> 一键修复全部</button>
          </>
        ) : (
          <div className="issue-clear"><CheckCircle2 size={18} /><div><strong>检查通过</strong><p>所有设备都在桌面内，互相之间没有重叠。</p></div></div>
        )}
      </div>
      {fixReport && <FixReportCard report={fixReport} onSelect={onSelect} onDismiss={onDismissReport} />}
      {issueCount > 0 && (
        <ul className="issue-list">
          {entries.map((entry) => (
            <IssueRow
              key={entry.itemId}
              entry={entry}
              isSelected={selectedItemId === entry.itemId}
              onSelect={() => onSelect(entry.itemId)}
              onFix={() => onFixItem(entry.itemId)}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
