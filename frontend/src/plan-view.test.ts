import { describe, expect, it } from 'vitest'

import { buildTaskDetails } from './plan-view'
import { makePlan } from './test/fixtures'

describe('task detail mapping', () => {
  it('maps predecessor and successor names without exposing UUID values', () => {
    const plan = makePlan()
    const first = buildTaskDetails(plan, plan.tasks[0])
    const second = buildTaskDetails(plan, plan.tasks[1])

    expect(first.successors).toEqual([{ publicId: 'TASK-002', name: 'UX-дизайн' }])
    expect(second.predecessors).toEqual([
      { publicId: 'TASK-001', name: 'Исследование продукта' },
    ])
    expect(JSON.stringify({ first: first.successors, second: second.predecessors })).not.toContain(
      '00000000-0000-4000',
    )
  })
})
