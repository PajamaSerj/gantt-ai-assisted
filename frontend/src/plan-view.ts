import type { PlanState, Task } from './types'

export type TaskDetails = {
  task: Task
  predecessors: { publicId: string; name: string }[]
  successors: { publicId: string; name: string }[]
}

export function buildTaskDetails(plan: PlanState, task: Task): TaskDetails {
  const byInternalId = new Map(plan.tasks.map((item) => [item.internal_id, item]))
  const predecessors = task.predecessor_ids.flatMap((internalId) => {
    const predecessor = byInternalId.get(internalId)
    return predecessor
      ? [{ publicId: predecessor.public_id, name: predecessor.name }]
      : []
  })
  const successors = plan.tasks
    .filter((candidate) => candidate.predecessor_ids.includes(task.internal_id))
    .map((candidate) => ({ publicId: candidate.public_id, name: candidate.name }))
  return { task, predecessors, successors }
}

export function formatPlanDate(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00`))
}
