import type { GanttTask } from 'frappe-gantt'

import type { PendingPlanPreview, PendingTaskPreview } from './pending-preview'
import type { PlanState } from './types'

export function compactTaskReference(publicId: string): string {
  const match = /^TASK-(\d+)$/i.exec(publicId)
  if (!match) return publicId
  return match[1].replace(/^0+(?=\d)/, '')
}

export function ganttTasks(
  plan: PlanState,
  affectedPublicIds: Set<string>,
): GanttTask[] {
  const publicIdByInternalId = new Map(
    plan.tasks.map((task) => [task.internal_id, task.public_id]),
  )
  return plan.tasks.map((task) => ({
    id: task.public_id,
    name: `${compactTaskReference(task.public_id)} · ${task.name}`,
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

export function currentPreviewTaskId(publicId: string): string {
  return `preview-current-${publicId}`
}

function previewTaskName(
  prefix: 'Сейчас' | 'После применения',
  publicId: string,
  name: string,
): string {
  return `${prefix}: ${compactTaskReference(publicId)} · ${name}`
}

function previewGhostTask(change: PendingTaskPreview): GanttTask | null {
  const task = change.currentTask
  if (!task) return null
  return {
    id: currentPreviewTaskId(task.public_id),
    name: previewTaskName('Сейчас', task.public_id, task.name),
    start: task.start_date,
    end: task.end_date,
    progress: 0,
    dependencies: '',
    custom_class: 'gantt-task-preview-current',
  }
}

export function ganttPreviewTasks(preview: PendingPlanPreview): GanttTask[] {
  const changeById = new Map(
    preview.changes.map((change) => [change.internalId, change]),
  )
  const publicIdByInternalId = new Map(
    preview.proposedPlan.tasks.map((task) => [task.internal_id, task.public_id]),
  )
  const rows: GanttTask[] = []

  for (const task of preview.proposedPlan.tasks) {
    const change = changeById.get(task.internal_id)
    if (change?.kind === 'dates') {
      const ghost = previewGhostTask(change)
      if (ghost) rows.push(ghost)
    }
    rows.push({
      id: task.public_id,
      name: change
        ? previewTaskName('После применения', task.public_id, task.name)
        : `${compactTaskReference(task.public_id)} · ${task.name}`,
      start: task.start_date,
      end: task.end_date,
      progress: 0,
      dependencies: task.predecessor_ids
        .map((internalId) => publicIdByInternalId.get(internalId))
        .filter((publicId): publicId is string => Boolean(publicId))
        .join(', '),
      custom_class: change ? 'gantt-task-preview-proposed' : undefined,
    })
  }

  for (const change of preview.changes) {
    if (change.kind !== 'removed') continue
    const ghost = previewGhostTask(change)
    if (ghost) rows.push(ghost)
  }
  return rows
}
