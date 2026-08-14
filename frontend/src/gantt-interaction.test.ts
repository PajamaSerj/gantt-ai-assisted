import { describe, expect, it } from 'vitest'

import {
  directEditIntent,
  disableLeftResizeHandles,
} from './gantt-interaction'
import { makePlan } from './test/fixtures'

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
})
