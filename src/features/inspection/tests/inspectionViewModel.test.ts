import { describe, expect, it } from 'vitest'
import { createItem, createPlan } from '../../../shared/models'
import { inspectPlan } from '../inspectionViewModel'

describe('inspection module', () => {
  it('turns layout analysis into a user-facing issue summary', () => {
    const plan = createPlan('检查', false)
    const first = { ...createItem('monitor'), x: 0, y: 0 }
    const second = { ...createItem('keyboard'), x: 100, y: 80 }
    const result = inspectPlan({ ...plan, items: [first, second] })
    expect(result.issueCount).toBe(2)
    expect(result.issueIds).toEqual(expect.arrayContaining([first.id, second.id]))
  })

  it('lists each problematic device with the device it overlaps and overflow edges', () => {
    const plan = createPlan('明细', false)
    const monitor = { ...createItem('monitor'), x: -30, y: 0 }
    const keyboard = { ...createItem('keyboard'), x: 100, y: 50 }
    const lamp = { ...createItem('lamp'), x: 1500, y: 700 }
    const result = inspectPlan({ ...plan, items: [monitor, keyboard, lamp] })

    const monitorIssue = result.issues.find((issue) => issue.itemId === monitor.id)
    expect(monitorIssue?.kind).toBe('both')
    expect(monitorIssue?.overflows.map((overflow) => overflow.edge)).toContain('left')
    expect(monitorIssue?.overlaps[0].otherItemId).toBe(keyboard.id)

    const lampIssue = result.issues.find((issue) => issue.itemId === lamp.id)
    expect(lampIssue?.kind).toBe('outOfBounds')
    expect(lampIssue?.overflows.map((overflow) => overflow.edge).sort()).toEqual(['bottom', 'right'])
  })

  it('keeps the detail list in canvas order', () => {
    const plan = createPlan('顺序', false)
    const a = { ...createItem('lamp'), x: -20, y: 0 }
    const b = { ...createItem('lamp'), x: 1600, y: 0 }
    const result = inspectPlan({ ...plan, items: [a, b] })
    expect(result.issues.map((issue) => issue.itemId)).toEqual([a.id, b.id])
  })
})
