import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Move, RotateCw } from 'lucide-react'
import type { DeskItem, LayoutAnalysis, WorkspacePlan } from '../../../shared/models'
import { getDeviceDefinition } from '../../../shared/models'
import { getItemBounds } from '../../../shared/layoutRules'

interface CanvasStageProps {
  plan: WorkspacePlan
  selectedItemId: string | null
  analysis: LayoutAnalysis
  onSelect: (id: string | null) => void
  onMove: (id: string, x: number, y: number) => void
}

interface DragState { id: string; offsetX: number; offsetY: number }

const EDGE_LABELS = { left: '左', top: '上', right: '右', bottom: '下' } as const

export function CanvasStage({ plan, selectedItemId, analysis, onSelect, onMove }: CanvasStageProps) {
  const stageRef = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const scaleToMm = useCallback((clientX: number, clientY: number) => {
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) return null
    return { x: ((clientX - rect.left) / rect.width) * plan.deskWidthMm, y: ((clientY - rect.top) / rect.height) * plan.deskHeightMm }
  }, [plan.deskHeightMm, plan.deskWidthMm])

  useEffect(() => {
    if (!drag) return
    const handleMove = (event: PointerEvent) => {
      const point = scaleToMm(event.clientX, event.clientY)
      if (!point) return
      onMove(drag.id, point.x - drag.offsetX, point.y - drag.offsetY)
    }
    const handleUp = () => setDrag(null)
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    return () => { window.removeEventListener('pointermove', handleMove); window.removeEventListener('pointerup', handleUp) }
  }, [drag, onMove, scaleToMm])

  // 从检查明细点选时，把容器平滑滚动到该设备附近（设备可能部分在视口外）
  useEffect(() => {
    if (!selectedItemId || !stageRef.current) return
    const item = plan.items.find((entry) => entry.id === selectedItemId)
    const container = stageRef.current.closest('.canvas-wrap')
    if (!item || !container) return
    const svgRect = stageRef.current.getBoundingClientRect()
    const bounds = getItemBounds(item)
    const scaleX = svgRect.width / plan.deskWidthMm
    const scaleY = svgRect.height / plan.deskHeightMm
    const targetX = ((bounds.left + bounds.right) / 2) * scaleX - container.clientWidth / 2
    const targetY = ((bounds.top + bounds.bottom) / 2) * scaleY - container.clientHeight / 2
    container.scrollTo({ left: targetX, top: targetY, behavior: 'smooth' })
  }, [selectedItemId, plan])

  const startDrag = (event: ReactPointerEvent<SVGGElement>, item: DeskItem) => {
    event.stopPropagation()
    const point = scaleToMm(event.clientX, event.clientY)
    if (!point) return
    onSelect(item.id)
    setDrag({ id: item.id, offsetX: point.x - item.x, offsetY: point.y - item.y })
  }

  const boundsById = new Map(plan.items.map((item) => [item.id, getItemBounds(item)]))
  const violationByItem = new Map(analysis.boundsViolations.map((violation) => [violation.itemId, violation]))

  return (
    <div className="canvas-wrap">
      <div className="canvas-toolbar"><span><Move size={14} /> 拖动设备调整位置</span><span><RotateCw size={14} /> 旋转请在右侧操作</span></div>
      <svg ref={stageRef} className="desk-canvas" viewBox={`0 0 ${plan.deskWidthMm} ${plan.deskHeightMm}`} role="img" aria-label={`桌面布局画布，${plan.deskWidthMm}乘${plan.deskHeightMm}毫米`} onPointerDown={() => onSelect(null)}>
        <defs>
          <pattern id="desk-grid" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M 50 0 L 0 0 0 50" fill="none" stroke="#d8e1ed" strokeWidth="1" /></pattern>
          <filter id="item-shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="8" stdDeviation="8" floodColor="#20304a" floodOpacity=".12" /></filter>
        </defs>
        <rect width={plan.deskWidthMm} height={plan.deskHeightMm} rx="22" fill="#f8fafc" />
        <rect width={plan.deskWidthMm} height={plan.deskHeightMm} rx="22" fill="url(#desk-grid)" />
        <text x="34" y="48" fill="#a0aec0" fontSize="20" letterSpacing="3">FOCUS ZONE / {plan.deskWidthMm} × {plan.deskHeightMm} MM</text>
        {analysis.overlapPairs.map((pair) => {
          const a = boundsById.get(pair.itemIds[0])
          const b = boundsById.get(pair.itemIds[1])
          if (!a || !b) return null
          const ax = Math.min(Math.max((a.left + a.right) / 2, 0), plan.deskWidthMm)
          const ay = Math.min(Math.max((a.top + a.bottom) / 2, 0), plan.deskHeightMm)
          const bx = Math.min(Math.max((b.left + b.right) / 2, 0), plan.deskWidthMm)
          const by = Math.min(Math.max((b.top + b.bottom) / 2, 0), plan.deskHeightMm)
          return <line className="overlap-link" key={`${pair.itemIds[0]}-${pair.itemIds[1]}`} x1={ax} y1={ay} x2={bx} y2={by} />
        })}
        {plan.items.map((item) => {
          const definition = getDeviceDefinition(item.type)
          const isSelected = selectedItemId === item.id
          const hasIssue = analysis.overlapIds.includes(item.id) || analysis.outOfBoundsIds.includes(item.id)
          const cx = item.x + item.widthMm / 2
          const cy = item.y + item.heightMm / 2
          const violation = violationByItem.get(item.id)
          const itemBounds = boundsById.get(item.id)
          return <g className={`desk-item ${isSelected ? 'is-selected' : ''} ${hasIssue ? 'has-issue' : ''}`} key={item.id} onPointerDown={(event) => startDrag(event, item)} role="button" tabIndex={0} aria-label={`${definition.label}，${item.widthMm}乘${item.heightMm}毫米`}>
            <g transform={`translate(${cx} ${cy}) rotate(${item.rotation})`}>
              <rect x={-item.widthMm / 2} y={-item.heightMm / 2} width={item.widthMm} height={item.heightMm} rx={Math.min(24, item.heightMm / 5)} fill={definition.color} filter="url(#item-shadow)" />
              <rect className="item-inner-line" x={-item.widthMm / 2 + 12} y={-item.heightMm / 2 + 12} width={Math.max(0, item.widthMm - 24)} height={Math.max(0, item.heightMm - 24)} rx={12} fill="none" />
              <text x="0" y="5" textAnchor="middle" fill="#1f2e44" fontWeight="700" fontSize={Math.max(18, Math.min(32, item.widthMm / 16))}>{definition.shortLabel}</text>
              <text x="0" y="30" textAnchor="middle" fill="#44546b" fontSize="16">{item.widthMm} × {item.heightMm}</text>
            </g>
            {isSelected && itemBounds && <rect className="selection-box" x={itemBounds.left - 8} y={itemBounds.top - 8} width={itemBounds.width + 16} height={itemBounds.height + 16} rx="12" fill="none" />}
            {hasIssue && itemBounds && <g transform={`translate(${Math.max(18, itemBounds.right - 4)} ${Math.max(18, itemBounds.top - 4)}`}><circle r="18" fill="#ef6a6a" /><text textAnchor="middle" y="7" fill="white" fontSize="22" fontWeight="700">!</text></g>}
            {violation && itemBounds && violation.overflows.map((overflow) => {
              const edgeX = overflow.edge === 'left' ? -6 : overflow.edge === 'right' ? plan.deskWidthMm + 6 : Math.min(Math.max(itemBounds.left + itemBounds.width / 2, 12), plan.deskWidthMm - 12)
              const edgeY = overflow.edge === 'top' ? -6 : overflow.edge === 'bottom' ? plan.deskHeightMm + 6 : Math.min(Math.max(itemBounds.top + itemBounds.height / 2, 12), plan.deskHeightMm - 12)
              return <g className="overflow-tag" key={overflow.edge} transform={`translate(${edgeX} ${edgeY})`}><circle r="15" fill="#e0813f" /><text textAnchor="middle" y="6" fill="white" fontSize="15" fontWeight="700">{EDGE_LABELS[overflow.edge]}</text></g>
            })}
          </g>
        })}
        {plan.items.length === 0 && <g><circle cx={plan.deskWidthMm / 2} cy={plan.deskHeightMm / 2 - 12} r="32" fill="#e8eef6" /><text x={plan.deskWidthMm / 2} y={plan.deskHeightMm / 2 + 2} textAnchor="middle" fill="#8493a8" fontSize="22">+</text><text x={plan.deskWidthMm / 2} y={plan.deskHeightMm / 2 + 48} textAnchor="middle" fill="#8493a8" fontSize="22">从左侧添加第一件设备</text></g>}
      </svg>
      <div className="canvas-legend"><span><i className="legend-dot clear-dot" /> 可用空间</span><span><i className="legend-dot issue-dot" /> 重叠压住</span><span><i className="legend-dot oob-dot" /> 超出桌面</span><span className="canvas-scale">网格：50 mm</span></div>
    </div>
  )
}
