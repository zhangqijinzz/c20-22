import { getDeviceDefinition, type DeskItem } from '../../shared/models'
import type { FixResult } from './inspectionFixer'

export type FixScope = 'all' | 'one'

export interface FixMoveLine {
  itemId: string
  label: string
  /** 例如：向左 60 mm，向上 18 mm，共移动 63 mm */
  deltaText: string
  distanceMm: number
}

export interface FixFailureLine {
  itemId: string
  label: string
  reason: 'oversize' | 'blocked'
  detail: string
}

export interface FixRoundReport {
  scope: FixScope
  moves: FixMoveLine[]
  failures: FixFailureLine[]
  movedCount: number
  attemptedCount: number
  fixedCount: number
  remainingCount: number
  changed: boolean
  title: string
  detail: string
}

function wholeMm(value: number): number {
  return Math.round(Math.abs(value))
}

function buildDeltaText(deltaX: number, deltaY: number, distanceMm: number): string {
  const parts: string[] = []
  if (Math.abs(deltaX) >= 0.5) parts.push(`${deltaX < 0 ? '向左' : '向右'} ${wholeMm(deltaX)} mm`)
  if (Math.abs(deltaY) >= 0.5) parts.push(`${deltaY < 0 ? '向上' : '向下'} ${wholeMm(deltaY)} mm`)
  if (parts.length === 0) return '位置未变'
  return `${parts.join('，')}，共移动 ${wholeMm(distanceMm)} mm`
}

export function buildFixReport(result: FixResult, items: DeskItem[], scope: FixScope): FixRoundReport {
  const labelOf = (id: string): string => {
    const item = items.find((candidate) => candidate.id === id)
    return item ? getDeviceDefinition(item.type).label : '设备'
  }

  const moves: FixMoveLine[] = result.moves
    .map((move) => ({
      itemId: move.itemId,
      label: labelOf(move.itemId),
      deltaText: buildDeltaText(move.deltaX, move.deltaY, move.distanceMm),
      distanceMm: move.distanceMm,
    }))
    .sort((left, right) => right.distanceMm - left.distanceMm)

  const failures: FixFailureLine[] = result.failures.map((failure) => ({
    itemId: failure.itemId,
    label: labelOf(failure.itemId),
    reason: failure.reason,
    detail: failure.detail,
  }))

  const movedCount = moves.length
  const attemptedCount = result.attemptedItemIds.length
  const fixedCount = result.fixedItemIds.length
  const remainingCount = result.afterEntries.length
  const changed = moves.length > 0

  let title: string
  let detail: string
  if (attemptedCount === 0) {
    title = '没有需要修复的问题'
    detail = '当前检查结果为空，所有设备都在桌面内且互不重叠。'
  } else if (scope === 'one') {
    const targetLabel = labelOf(result.attemptedItemIds[0])
    const targetFailure = failures[0]
    if (remainingCount === 0 || (targetFailure === undefined && !result.afterEntries.some((entry) => entry.itemId === result.attemptedItemIds[0]))) {
      title = changed ? `「${targetLabel}」已修好，复检通过` : `「${targetLabel}」没有问题`
      detail = changed
        ? `自动移动了「${targetLabel}」（${moves[0]?.deltaText ?? ''}），重新检查后该设备已在桌面内且不再压住其他设备。`
        : '重新检查后该设备不存在任何问题，无需移动。'
    } else if (changed) {
      title = `「${targetLabel}」已移动，但复检仍未通过`
      detail = targetFailure
        ? `已按最小移动量挪动该设备（${moves[0]?.deltaText ?? ''}），但问题依旧：${targetFailure.detail}`
        : `已挪动该设备（${moves[0]?.deltaText ?? ''}），但重新检查后仍有问题。`
    } else {
      title = `「${targetLabel}」无法自动修复`
      detail = targetFailure ? targetFailure.detail : '该设备无法在不产生新冲突的情况下自动归位，请手动调整。'
    }
  } else if (remainingCount === 0) {
    title = changed ? `已全部修好，复检通过（${fixedCount} 件）` : '布局没有问题'
    detail = changed
      ? `本轮共移动 ${movedCount} 件设备，全部按最小移动量调整；重新检查后没有越界、没有重叠。`
      : '所有设备都在桌面内且互不重叠，未做任何改动。'
  } else {
    title = changed ? `已移动 ${movedCount} 件，复检仍有 ${remainingCount} 件存在问题` : '无法自动修复，本轮未移动任何设备'
    detail = changed
      ? `已尝试把 ${attemptedCount} 件问题设备按最小移动量调整，${fixedCount} 件复检通过，但仍有 ${remainingCount} 件存在问题，原因见下方明细。`
      : `检查到 ${attemptedCount} 件问题设备，但沿最小移动方向都没有可用空间，未能移动任何设备，原因见下方明细。`
  }

  return { scope, moves, failures, movedCount, attemptedCount, fixedCount, remainingCount, changed, title, detail }
}
