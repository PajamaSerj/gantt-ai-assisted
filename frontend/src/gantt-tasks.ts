import type { GanttTask } from 'frappe-gantt'

import type { PlanState } from './types'

export function ganttTasks(
  plan: PlanState,
  affectedPublicIds: Set<string>,
): GanttTask[] {
  const publicIdByInternalId = new Map(
    plan.tasks.map((task) => [task.internal_id, task.public_id]),
  )
  return plan.tasks.map((task) => ({
    id: task.public_id,
    name: `${task.public_id} · ${task.name}`,
    start: task.start_date,
    end: task.end_date,
    progress: 0,
    dependencies: task.predecessor_ids
      .map((internalId) => publicIdByInternalId.get(internalId))
      .filter((publicId): publicId is string => Boolean(publicId))
      .join(', '),
    custom_class: affectedPublicIds.has(task.public_id)
      ? 'gantt-task-affected'
      : undefined,
  }))
}
