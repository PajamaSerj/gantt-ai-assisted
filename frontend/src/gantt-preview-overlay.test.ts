import { describe, expect, it } from 'vitest'

import {
  previewDeltaLabel,
  previewReasonLabel,
  resolveSameRowPreviewGeometry,
  signedWorkingDayDelta,
} from './gantt-preview-overlay'
import { buildPendingPlanPreview, type PendingTaskPreview } from './pending-preview'
import { makePlan, makeSergeyPendingScenario } from './test/fixtures'

const DAY_WIDTH = 10

function dateToX(value: string | Date): number {
  const date = typeof value === 'string'
    ? new Date(`${value}T00:00:00`)
    : value
  return Math.round(
    (date.getTime() - new Date('2026-02-01T00:00:00').getTime()) /
    86_400_000 * DAY_WIDTH,
  )
}

function currentGeometry(change: PendingTaskPreview) {
  const task = change.currentTask
  if (!task) throw new Error('Expected current task')
  const exclusiveEnd = new Date(`${task.end_date}T00:00:00`)
  exclusiveEnd.setDate(exclusiveEnd.getDate() + 1)
  return {
    x: dateToX(task.start_date),
    y: 164,
    width: dateToX(exclusiveEnd) - dateToX(task.start_date),
    height: 32,
  }
}

function previewChange(publicId: string): PendingTaskPreview {
  const { current, changeset } = makeSergeyPendingScenario()
  const preview = buildPendingPlanPreview(current, changeset)
  const change = preview?.changes.find((candidate) => (
    candidate.publicId === publicId
  ))
  if (!change) throw new Error(`Expected preview change for ${publicId}`)
  return change
}

function changedDates(
  start: string,
  end: string,
  duration: number,
): PendingTaskPreview {
  const current = makePlan().tasks[1]
  return {
    internalId: current.internal_id,
    publicId: current.public_id,
    name: current.name,
    currentTask: current,
    proposedTask: {
      ...current,
      start_date: start,
      end_date: end,
      duration_workdays: duration,
    },
    kind: 'dates',
    source: 'direct',
    dependencyName: null,
  }
}

describe('same-row Gantt preview geometry', () => {
  it('renders a rightward move with a right-pointing connector', () => {
    const change = previewChange('TASK-005')
    const geometry = resolveSameRowPreviewGeometry(
      change,
      currentGeometry(change),
      dateToX,
      { start: 0, end: 500 },
    )

    expect(geometry?.direction).toBe('right')
    expect(geometry?.connector).toMatchObject({ direction: 'right' })
    expect(geometry!.connector!.x1).toBeLessThan(geometry!.connector!.x2)
    expect(geometry?.proposedY).toBe(geometry?.currentY)
    expect(geometry?.deltaLabel).toBe('+5 раб. дней')
  })

  it('renders a leftward move with a left-pointing connector', () => {
    const change = changedDates('2026-01-26', '2026-01-29', 4)
    const geometry = resolveSameRowPreviewGeometry(
      change,
      currentGeometry(change),
      dateToX,
      { start: -200, end: 500 },
    )

    expect(geometry?.direction).toBe('left')
    expect(geometry?.connector).toMatchObject({ direction: 'left' })
    expect(geometry!.connector!.x1).toBeGreaterThan(geometry!.connector!.x2)
    expect(geometry?.deltaLabel).toBe('−8 раб. дней')
  })

  it('uses product-language reasons for direct and propagated changes', () => {
    expect(previewReasonLabel('direct')).toBe('Запрошенное изменение')
    expect(previewReasonLabel('dependency')).toBe('Сдвиг из-за зависимости')
    expect(previewChange('TASK-003').source).toBe('direct')
    expect(previewChange('TASK-006').source).toBe('dependency')
  })

  it('aligns a resize at the current start and emphasizes proposed duration', () => {
    const change = changedDates('2026-02-05', '2026-02-12', 6)
    const current = currentGeometry(change)
    const geometry = resolveSameRowPreviewGeometry(
      change,
      current,
      dateToX,
      { start: 0, end: 500 },
    )

    expect(geometry?.direction).toBe('resize')
    expect(geometry?.proposedX).toBe(current.x)
    expect(geometry?.proposedWidth).toBeGreaterThan(current.width)
    expect(geometry?.deltaLabel).toBe('4 → 6 раб. дней')
    expect(geometry?.connector).toBeNull()
  })

  it('keeps a shorter resize boundary visible inside the current bar', () => {
    const change = changedDates('2026-02-05', '2026-02-06', 2)
    const current = currentGeometry(change)
    const geometry = resolveSameRowPreviewGeometry(
      change,
      current,
      dateToX,
      { start: 0, end: 500 },
    )

    expect(geometry?.direction).toBe('resize')
    expect(geometry?.overlapsCurrent).toBe(true)
    expect(geometry?.proposedEndX).toBeLessThan(current.x + current.width)
  })

  it('keeps overlapping moves distinguishable without forcing a connector', () => {
    const change = changedDates('2026-02-09', '2026-02-12', 4)
    const geometry = resolveSameRowPreviewGeometry(
      change,
      currentGeometry(change),
      dateToX,
      { start: 0, end: 500 },
    )

    expect(geometry?.direction).toBe('right')
    expect(geometry?.overlapsCurrent).toBe(true)
    expect(geometry?.connector).toBeNull()
    expect(geometry?.deltaLabel).toBe('+2 раб. дня')
  })

  it('clamps compact labels inside both timeline edges', () => {
    const leftChange = changedDates('2026-01-26', '2026-01-29', 4)
    const left = resolveSameRowPreviewGeometry(
      leftChange,
      currentGeometry(leftChange),
      dateToX,
      { start: -70, end: 180 },
    )
    const rightChange = previewChange('TASK-007')
    const right = resolveSameRowPreviewGeometry(
      rightChange,
      currentGeometry(rightChange),
      dateToX,
      { start: 220, end: 430 },
    )

    expect(left!.labelX).toBeGreaterThanOrEqual(-66)
    expect(left!.labelX + left!.labelWidth).toBeLessThanOrEqual(176)
    expect(right!.labelX).toBeGreaterThanOrEqual(224)
    expect(right!.labelX + right!.labelWidth).toBeLessThanOrEqual(426)
  })

  it('counts signed deltas with the existing Monday-to-Friday calendar', () => {
    expect(signedWorkingDayDelta('2026-02-20', '2026-02-25')).toBe(3)
    expect(signedWorkingDayDelta('2026-03-02', '2026-02-27')).toBe(-1)
    expect(previewDeltaLabel(changedDates(
      '2026-02-09',
      '2026-02-12',
      4,
    ))).toBe('+2 раб. дня')
  })
})
