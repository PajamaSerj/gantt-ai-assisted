import { describe, expect, it } from 'vitest'

import {
  directEditIntent,
  disableLeftResizeHandles,
  keepProposedPreviewLabelsVisible,
} from './gantt-interaction'
import { makePlan, makeSergeyPendingScenario } from './test/fixtures'

describe('Gantt direct interaction helpers', () => {
  it('classifies horizontal start movement as a move request', () => {
    const task = makePlan().tasks[0]
    expect(directEditIntent(task, {
      taskPublicId: task.public_id,
      start: new Date(2026, 1, 3, 12),
      end: new Date(2026, 1, 5, 12),
    })).toEqual({ type: 'move', task, intendedDate: '2026-02-03' })
  })

  it('classifies a right-edge end change as a resize request', () => {
    const task = makePlan().tasks[0]
    expect(directEditIntent(task, {
      taskPublicId: task.public_id,
      start: new Date(2026, 1, 2, 12),
      end: new Date(2026, 1, 6, 12),
    })).toEqual({ type: 'resize', task, intendedDate: '2026-02-06' })
  })

  it('snaps a Friday drag landing on the weekend forward to Monday', () => {
    const task = makeSergeyPendingScenario().current.tasks[6]

    expect(directEditIntent(task, {
      taskPublicId: task.public_id,
      start: new Date(2026, 1, 28, 12),
      end: new Date(2026, 2, 3, 12),
    })).toEqual({ type: 'move', task, intendedDate: '2026-03-02' })
  })

  it('snaps a leftward drag landing on the weekend back to Friday', () => {
    const source = makeSergeyPendingScenario().current.tasks[6]
    const task = {
      ...source,
      start_date: '2026-03-02',
      end_date: '2026-03-03',
    }

    expect(directEditIntent(task, {
      taskPublicId: task.public_id,
      start: new Date(2026, 2, 1, 12),
      end: new Date(2026, 2, 2, 12),
    })).toEqual({ type: 'move', task, intendedDate: '2026-02-27' })
  })

  it('keeps a working-day drag target unchanged', () => {
    const task = makeSergeyPendingScenario().current.tasks[6]

    expect(directEditIntent(task, {
      taskPublicId: task.public_id,
      start: new Date(2026, 2, 3, 12),
      end: new Date(2026, 2, 4, 12),
    })).toEqual({ type: 'move', task, intendedDate: '2026-03-03' })
  })

  it('snaps a right-edge extension landing on the weekend forward', () => {
    const source = makeSergeyPendingScenario().current.tasks[6]
    const task = {
      ...source,
      start_date: '2026-02-25',
      end_date: '2026-02-27',
    }

    expect(directEditIntent(task, {
      taskPublicId: task.public_id,
      start: new Date(2026, 1, 25, 12),
      end: new Date(2026, 1, 28, 12),
    })).toEqual({ type: 'resize', task, intendedDate: '2026-03-02' })
  })

  it('snaps a right-edge contraction landing on the weekend backward', () => {
    const task = makeSergeyPendingScenario().current.tasks[6]

    expect(directEditIntent(task, {
      taskPublicId: task.public_id,
      start: new Date(2026, 1, 27, 12),
      end: new Date(2026, 2, 1, 12),
    })).toEqual({ type: 'resize', task, intendedDate: '2026-02-27' })
  })

  it('makes the library left-edge resize handle non-interactive', () => {
    const container = document.createElement('div')
    container.innerHTML = '<svg><rect class="handle left"></rect><rect class="handle right"></rect></svg>'

    disableLeftResizeHandles(container)

    const left = container.querySelector<SVGElement>('.handle.left')
    const right = container.querySelector<SVGElement>('.handle.right')
    expect(left?.style.pointerEvents).toBe('none')
    expect(left?.style.opacity).toBe('0')
    expect(left).toHaveAttribute('aria-hidden', 'true')
    expect(right?.style.pointerEvents).toBe('')
  })

  it('positions an overflowing proposed label before a right-edge bar', () => {
    const container = document.createElement('div')
    container.innerHTML = `
      <svg class="gantt" width="400">
        <rect class="grid-row" width="400"></rect>
        <g class="bar-wrapper gantt-task-preview-proposed">
          <rect class="bar" x="330" width="40"></rect>
          <text class="bar-label big" x="375">После применения: Подготовка демо</text>
        </g>
      </svg>
    `
    const label = container.querySelector<SVGTextElement>('.bar-label')
    if (!label) throw new Error('Expected proposed preview label')
    Object.defineProperty(label, 'getBBox', {
      value: () => ({ width: 180 }),
    })

    keepProposedPreviewLabelsVisible(container)

    expect(label).toHaveAttribute('x', '325')
    expect(label).toHaveAttribute('text-anchor', 'end')
    expect(label).toHaveClass('gantt-label-before')
  })
})
