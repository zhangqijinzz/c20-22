import { describe, expect, it } from 'vitest'
import { createItem } from '../../../shared/models'
import { repairLayout } from '../repairEngine'
import { inspectPlan } from '../inspectionViewModel'

function scenarioPlan(items: ReturnType<typeof createItem>[], deskWidthMm = 1600, deskHeightMm = 800) {
  return { id: 'p', name: 's', deskWidthMm, deskHeightMm, items, updatedAt: '' }
}

describe('repairLayout integration scenarios', () => {
  it('resolves a chain of overlaps plus out-of-bounds devices without leaving anyone out', () => {
    const items = [
      { ...createItem('monitor'), x: 100, y: 100 },
      { ...createItem('monitor'), x: 200, y: 150 },
      { ...createItem('monitor'), x: 300, y: 200 },
      { ...createItem('keyboard'), x: 250, y: 350 },
      { ...createItem('lamp'), x: -80, y: -40 },
      { ...createItem('speaker'), x: 1550, y: 720 },
    ]
    const report = repairLayout(scenarioPlan(items))

    expect(report.ok).toBe(true)
    expect(report.after.overlapPairs).toHaveLength(0)
    expect(report.after.outOfBoundsIds).toHaveLength(0)
    expect(report.actions.length).toBeGreaterThan(0)
  })

  it('fans out a pile of overlapping small devices inside the desk', () => {
    const items = Array.from({ length: 6 }, (_, index) => ({
      ...createItem(index % 2 ? 'speaker' : 'lamp'),
      x: 700,
      y: 300,
    }))
    const report = repairLayout(scenarioPlan(items))

    expect(report.ok).toBe(true)
    expect(report.after.overlapPairs).toHaveLength(0)
    expect(report.after.outOfBoundsIds).toHaveLength(0)
  })

  it('keeps a clear layout untouched', () => {
    const items = [
      { ...createItem('monitor'), x: 100, y: 100 },
      { ...createItem('keyboard'), x: 580, y: 470 },
    ]
    const report = repairLayout(scenarioPlan(items))

    expect(report.ok).toBe(true)
    expect(report.actions).toHaveLength(0)
    expect(report.plan.items).toEqual(items)
  })

  it('report.after always matches an honest recheck of the resulting plan', () => {
    const items = [
      { ...createItem('monitor'), x: 100, y: 100 },
      { ...createItem('keyboard'), x: 200, y: 150 },
      { ...createItem('lamp'), x: -90, y: 400 },
    ]
    const report = repairLayout(scenarioPlan(items))
    const rechecked = inspectPlan(report.plan)

    expect(report.after.status).toBe(rechecked.analysis.status)
    expect(report.after.overlapPairs.length).toBe(rechecked.analysis.overlapPairs.length)
    expect([...report.after.outOfBoundsIds].sort()).toEqual([...rechecked.analysis.outOfBoundsIds].sort())
    // ok 必须与真实复查一致，绝不允许“报成功但实际还有问题”
    expect(report.ok).toBe(rechecked.issueCount === 0)
  })

  it('pushes a rotated out-of-bounds item back using its rotated bounding box', () => {
    const rotated = { ...createItem('monitor'), rotation: 90, x: 60, y: -40 } // 旋转后占地 210×540
    const report = repairLayout(scenarioPlan([rotated]))

    expect(report.ok).toBe(true)
    expect(report.after.outOfBoundsIds).toHaveLength(0)
  })
})
