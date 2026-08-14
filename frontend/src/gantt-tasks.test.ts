import { describe, expect, it } from 'vitest'

import { ganttTasks } from './gantt-tasks'
import { makePlan, makeSergeyPendingScenario } from './test/fixtures'

describe('gantt task presentation', () => {
  it('shows compact public-ID numbers with task names and maps dependencies', () => {
    const tasks = ganttTasks(makePlan(), new Set(['TASK-002']))

    expect(tasks[0].name).toBe('1 · Исследование продукта')
    expect(tasks[1].name).toBe('2 · UX-дизайн')
    expect(tasks[1].dependencies).toBe('TASK-001')
    expect(tasks[1].custom_class).toBe('gantt-task-affected')
    expect(JSON.stringify(tasks)).not.toContain('00000000-0000-4000')
  })

  it('preserves public-ID gaps instead of deriving numbers from array order', () => {
    const plan = makePlan()
    plan.tasks[0].public_id = 'TASK-009'
    plan.tasks[1].public_id = 'TASK-007'

    const tasks = ganttTasks(plan, new Set())

    expect(tasks.map((task) => task.name)).toEqual([
      '9 · Исследование продукта',
      '7 · UX-дизайн',
    ])
    expect(tasks[1].dependencies).toBe('TASK-009')
  })

  it('keeps exactly one authoritative row per current task', () => {
    const { current } = makeSergeyPendingScenario()

    const tasks = ganttTasks(current, new Set())

    expect(tasks).toHaveLength(7)
    expect(tasks.map((task) => task.id)).toEqual(
      current.tasks.map((task) => task.public_id),
    )
    expect(JSON.stringify(tasks)).not.toContain('preview-current-')
    expect(JSON.stringify(tasks)).not.toContain('После применения:')
  })
})
