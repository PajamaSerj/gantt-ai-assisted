import { describe, expect, it } from 'vitest'

import { ganttTasks } from './gantt-tasks'
import { makePlan } from './test/fixtures'

describe('gantt task presentation', () => {
  it('shows public ID with task name and maps dependencies by public ID', () => {
    const tasks = ganttTasks(makePlan(), new Set(['TASK-002']))

    expect(tasks[0].name).toBe('TASK-001 · Исследование продукта')
    expect(tasks[1].name).toBe('TASK-002 · UX-дизайн')
    expect(tasks[1].dependencies).toBe('TASK-001')
    expect(tasks[1].custom_class).toBe('gantt-task-affected')
    expect(JSON.stringify(tasks)).not.toContain('00000000-0000-4000')
  })
})
