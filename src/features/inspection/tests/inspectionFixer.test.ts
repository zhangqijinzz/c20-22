import { describe, expect, it } from 'vitest'
import { createItem, createPlan } from '../../../shared/models'
import { autoFixLayout } from '../inspectionFixer'
import { buildFixReport } from '../inspectionReport'

function planWith(items: ReturnType<typeof createItem>[], deskWidthMm = 1600, deskHeightMm = 800) {
  return { ...createPlan('修复测试', false), deskWidthMm, deskHeightMm, items }
}

describe('autoFixLayout - 越界推回', () => {
  it('把越界设备推回桌面内，并按真实复检判定修复结果', () => {
    const item = { ...createItem('lamp'), x: 1600 - 90, y: 50 } // 右边伸出 90 mm
    const plan = planWith([item])
    const result = autoFixLayout(plan)

    expect(result.failures).toHaveLength(0)
    expect(result.fixedItemIds).toEqual([item.id])
    expect(result.afterEntries).toHaveLength(0)
    const moved = result.items[0]
    expect(Math.round(moved.x + moved.widthMm)).toBeLessThanOrEqual(1600)
    expect(moved.x).toBeGreaterThanOrEqual(0)
    // 推回恰好需要 90 mm，不应多移动
    expect(Math.round(result.moves[0].distanceMm)).toBe(90)
  })

  it('设备投影本身比桌面还大时不做假修复，而是给出 oversize 原因', () => {
    const huge = { ...createItem('monitor'), x: -200, y: 100, rotation: 90, widthMm: 1000, heightMm: 200 }
    const plan = planWith([huge], 300, 600) // 旋转后投影宽 200 < 300 OK；高 1000 > 600 无法放回
    const result = autoFixLayout(plan)

    expect(result.moves).toHaveLength(0)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0].reason).toBe('oversize')
    expect(result.afterEntries.length).toBeGreaterThan(0)
    expect(result.fixedItemIds).toHaveLength(0)
  })
})

describe('autoFixLayout - 重叠分开（最小移动量）', () => {
  it('两件可双向让行的设备各承担一半位移', () => {
    // 宽度 200 的方块分别放在 x=150 和 x=300，X 向重叠 50
    const a = { ...createItem('lamp'), x: 150, y: 200, widthMm: 200, heightMm: 200 }
    const b = { ...createItem('speaker'), x: 300, y: 200, widthMm: 200, heightMm: 200 }
    const result = autoFixLayout(planWith([a, b]))

    expect(result.afterEntries).toHaveLength(0)
    expect(result.failures).toHaveLength(0)
    const moveA = result.moves.find((move) => move.itemId === a.id)
    const moveB = result.moves.find((move) => move.itemId === b.id)
    expect(moveA).toBeDefined()
    expect(moveB).toBeDefined()
    expect(Math.abs(Math.round(moveA!.deltaX))).toBe(25)
    expect(Math.abs(Math.round(moveB!.deltaX))).toBe(25)
    expect(Math.round(moveA!.deltaX)).toBe(-25)
    expect(Math.round(moveB!.deltaX)).toBe(25)
  })

  it('一件被墙顶住时，把剩余位移全部分给另一件', () => {
    // a 靠左墙：左边没有可让空间，50 mm 重叠全部由 b 向右承担
    const a = { ...createItem('lamp'), x: 0, y: 200, widthMm: 200, heightMm: 200 }
    const b = { ...createItem('speaker'), x: 150, y: 200, widthMm: 200, heightMm: 200 }
    const result = autoFixLayout(planWith([a, b]))

    expect(result.afterEntries).toHaveLength(0)
    expect(result.moves.find((move) => move.itemId === a.id)).toBeUndefined()
    const moveB = result.moves.find((move) => move.itemId === b.id)
    expect(Math.round(moveB!.deltaX)).toBe(50)
  })

  it('沿最小穿透轴分开：X 叠 100、Y 只叠 20 时沿 Y 移动', () => {
    const a = { ...createItem('monitor'), x: 100, y: 100, widthMm: 400, heightMm: 200 }
    const b = { ...createItem('monitor'), x: 200, y: 280, widthMm: 400, heightMm: 200 }
    const result = autoFixLayout(planWith([a, b]))

    expect(result.afterEntries).toHaveLength(0)
    result.moves.forEach((move) => {
      expect(Math.abs(move.deltaX)).toBeLessThan(0.5)
      expect(Math.abs(move.deltaY)).toBeGreaterThan(1)
    })
  })

  it('四面都被墙和设备封死、确实分不开时，返回 blocked 而不是假装修好', () => {
    const deskWidth = 500
    const deskHeight = 200
    // 两件 300×200 的设备在 500×200 桌面内重叠 100，任何方向都让不出空间
    const a = { ...createItem('monitor'), x: 0, y: 0, widthMm: 300, heightMm: 200 }
    const b = { ...createItem('keyboard'), x: 200, y: 0, widthMm: 300, heightMm: 200 }
    const result = autoFixLayout(planWith([a, b], deskWidth, deskHeight))

    expect(result.moves).toHaveLength(0)
    expect(result.failures.length).toBeGreaterThan(0)
    expect(result.failures.every((failure) => failure.reason === 'blocked')).toBe(true)
    expect(result.afterEntries.length).toBeGreaterThan(0)
  })
})

describe('autoFixLayout - 单件修复范围', () => {
  it('只移动目标设备，其他设备保持原地不动，目标被封死时如实报告', () => {
    // a 靠左墙，b 与其重叠。单独修 b 时 a 不动，b 需要向右走 50
    const a = { ...createItem('lamp'), x: 0, y: 200, widthMm: 200, heightMm: 200 }
    const b = { ...createItem('speaker'), x: 150, y: 200, widthMm: 200, heightMm: 200 }
    const result = autoFixLayout(planWith([a, b]), b.id)

    expect(result.items.find((item) => item.id === a.id)).toEqual(a)
    const moveB = result.moves.find((move) => move.itemId === b.id)
    expect(Math.round(moveB!.deltaX)).toBe(50)
    expect(result.fixedItemIds).toEqual([b.id])
  })

  it('目标本身没有问题时不产生任何改动', () => {
    const a = { ...createItem('lamp'), x: 0, y: 200, widthMm: 200, heightMm: 200 }
    const b = { ...createItem('speaker'), x: 400, y: 200, widthMm: 200, heightMm: 200 }
    const plan = planWith([a, b])
    const result = autoFixLayout(plan, a.id)
    expect(result.attemptedItemIds).toHaveLength(0)
    expect(result.moves).toHaveLength(0)
    expect(result.items).toEqual(plan.items)
  })
})

describe('buildFixReport - 本轮改动说明', () => {
  it('修复成功时说明移动了谁、移动量与复检结论', () => {
    const item = { ...createItem('lamp'), x: 1600 - 90, y: 50 }
    const result = autoFixLayout(planWith([item]))
    const report = buildFixReport(result, result.items, 'all')
    expect(report.remainingCount).toBe(0)
    expect(report.changed).toBe(true)
    expect(report.failures).toHaveLength(0)
    expect(report.moves[0].deltaText).toContain('向左 90 mm')
  })

  it('修不动时标题与明细必须说明原因，不得宣称完成', () => {
    const a = { ...createItem('monitor'), x: 0, y: 0, widthMm: 300, heightMm: 200 }
    const b = { ...createItem('keyboard'), x: 200, y: 0, widthMm: 300, heightMm: 200 }
    const result = autoFixLayout(planWith([a, b], 500, 200))
    const report = buildFixReport(result, result.items, 'all')
    expect(report.remainingCount).toBeGreaterThan(0)
    expect(report.changed).toBe(false)
    expect(report.title).toContain('无法自动修复')
    expect(report.failures.length).toBeGreaterThan(0)
  })
})
