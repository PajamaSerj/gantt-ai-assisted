import { describe, expect, it } from 'vitest'

import { ganttPreviewTasks, ganttTasks } from './gantt-tasks'
import { buildPendingPlanPreview } from './pending-preview'
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

  it('renders separate current and proposed rows for changed dates', () => {
    const { current, changeset } = makeSergeyPendingScenario()
    const preview = buildPendingPlanPreview(current, changeset)
    expect(preview).not.toBeNull()

    const tasks = ganttPreviewTasks(preview!)
    const currentTask3 = tasks.find(
      (task) => task.id === 'preview-current-TASK-003',
    )
    const proposedTask3 = tasks.find((task) => task.id === 'TASK-003')
    const unchangedTask2 = tasks.find((task) => task.id === 'TASK-002')

    expect(currentTask3).toMatchObject({
      name: 'Сейчас: 3 · Backend foundation',
      start: '2026-02-05',
      end: '2026-02-11',
      dependencies: '',
      custom_class: 'gantt-task-preview-current',
    })
    expect(proposedTask3).toMatchObject({
      name: 'После применения: 3 · Backend foundation',
      start: '2026-02-12',
      end: '2026-02-18',
      dependencies: 'TASK-001',
      custom_class: 'gantt-task-preview-proposed',
    })
    expect(unchangedTask2?.name).toBe('2 · UX design')
    expect(tasks).toHaveLength(11)
  })
})
