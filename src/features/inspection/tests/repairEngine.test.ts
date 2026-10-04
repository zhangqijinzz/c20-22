import { describe, expect, it } from 'vitest'
import { createItem, createPlan } from '../../../shared/models'
import { analyzeLayout } from '../../../shared/layoutRules'
import { repairLayout } from '../repairEngine'

function planWith(items: ReturnType<typeof createItem>[], deskWidthMm = 1600, deskHeightMm = 800) {
  return { ...createPlan('修复测试', false), items, deskWidthMm, deskHeightMm }
}

describe('repairLayout', () => {
  it('把越界设备按越出量推回桌面内，并复查通过', () => {
    // 180mm 宽的灯，左边缘在 -60，推回 60 即可
    const lamp = { ...createItem('lamp'), x: -60, y: 100 }
    const plan = planWith([lamp])
    const report = repairLayout(plan)

    expect(report.actions).toHaveLength(1)
    expect(report.actions[0]).toMatchObject({ kind: 'bounds', itemId: lamp.id })
    expect(report.plan.items[0].x).toBeCloseTo(0, 6)
    expect(report.ok).toBe(true)
    expect(report.after.status).toBe('clear')
  })

  it('按最小移动量分开重叠：沿侵入较浅的轴只推动一件', () => {
    // 两个 400×200 的设备：x 侵入 200，y 侵入 100 → 应沿 y 轴分开（移动约 102mm）
    const first = { ...createItem('monitor'), widthMm: 400, heightMm: 200, x: 100, y: 100 }
    const second = { ...createItem('keyboard'), widthMm: 400, heightMm: 200, x: 300, y: 200 }
    const report = repairLayout(planWith([first, second]))

    expect(report.ok).toBe(true)
    expect(report.after.overlapPairs).toHaveLength(0)
    expect(report.actions).toHaveLength(1)
    const action = actionsOf(report, second.id).length > 0 ? actionsOf(report, second.id)[0] : actionsOf(report, first.id)[0]
    expect(action.distanceMm).toBeGreaterThan(100)
    expect(action.distanceMm).toBeLessThan(105)
  })

  it('设备比桌面还大时如实报告修不动，而不是假装成功', () => {
    const huge = { ...createItem('monitor'), widthMm: 2000, heightMm: 200, x: -100, y: 100 }
    const plan = planWith([huge], 1000, 800)
    const report = repairLayout(plan)

    expect(report.ok).toBe(false)
    expect(report.after.status).toBe('attention')
    expect(report.reasons[huge.id]).toContain('比桌面')
  })

  it('两个大设备塞满桌面无法平移分开时，报告残留重叠和原因', () => {
    // 桌面 500×500，两件 480×260：横向放不下两件、竖向也无法上下排开
    const first = { ...createItem('monitor'), widthMm: 480, heightMm: 260, x: 10, y: 10 }
    const second = { ...createItem('keyboard'), widthMm: 480, heightMm: 260, x: 10, y: 200 }
    const report = repairLayout(planWith([first, second], 500, 500))

    expect(report.ok).toBe(false)
    expect(report.after.overlapPairs.length).toBeGreaterThan(0)
    expect(report.remainingOverlapItemIds.sort()).toEqual([first.id, second.id].sort())
    expect(Object.keys(report.reasons).length).toBeGreaterThan(0)
  })

  it('单件修复只移动被指定的设备', () => {
    const first = { ...createItem('monitor'), widthMm: 400, heightMm: 200, x: 100, y: 100 }
    const second = { ...createItem('keyboard'), widthMm: 400, heightMm: 200, x: 300, y: 200 }
    const third = { ...createItem('lamp'), x: -50, y: 600 }
    const report = repairLayout(planWith([first, second, third]), { scopeItemId: second.id })

    expect(report.actions.every((action) => action.itemId === second.id)).toBe(true)
    // 第三件仍然越界，但不在本次修复范围内
    expect(report.after.outOfBoundsIds).toContain(third.id)
    expect(report.ok).toBe(true)
  })

  it('分离重叠时不会把设备推出桌面边界', () => {
    // 第二个设备紧贴右边界且与第一个重叠，只能向左（或第一个向右）分离
    const first = { ...createItem('monitor'), widthMm: 300, heightMm: 200, x: 1200, y: 300 }
    const second = { ...createItem('keyboard'), widthMm: 300, heightMm: 200, x: 1400, y: 400 }
    const report = repairLayout(planWith([first, second]))

    expect(report.ok).toBe(true)
    for (const item of report.plan.items) {
      const after = analyzeLayout(report.plan)
      expect(after.outOfBoundsIds).not.toContain(item.id)
    }
  })
})

function actionsOf(report: ReturnType<typeof repairLayout>, itemId: string) {
  return report.actions.filter((action) => action.itemId === itemId)
}
