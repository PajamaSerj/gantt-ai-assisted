import type { ChangeSet, PlanState, ProposedImpact, Task } from './types'

export type PendingTaskChangeKind = 'dates' | 'details' | 'added' | 'removed'
export type PendingTaskChangeSource = 'direct' | 'dependency' | 'related'

export type PendingTaskPreview = {
  internalId: string
  publicId: string
  name: string
  currentTask: Task | null
  proposedTask: Task | null
  kind: PendingTaskChangeKind
  source: PendingTaskChangeSource
  dependencyName: string | null
}

export type PendingPlanPreview = {
  currentPlan: PlanState
  proposedPlan: PlanState
  changes: PendingTaskPreview[]
  directCount: number
  dependencyCount: number
}

const MONTHS = [
  'янв.',
  'февр.',
  'марта',
  'апр.',
  'мая',
  'июня',
  'июля',
  'авг.',
  'сент.',
  'окт.',
  'нояб.',
  'дек.',
] as const

function sameTask(left: Task, right: Task): boolean {
  return (
    left.public_id === right.public_id &&
    left.name === right.name &&
    left.description === right.description &&
    left.assignee === right.assignee &&
    left.duration_workdays === right.duration_workdays &&
    left.start_date === right.start_date &&
    left.end_date === right.end_date &&
    left.created_source === right.created_source &&
    left.predecessor_ids.length === right.predecessor_ids.length &&
    left.predecessor_ids.every(
      (predecessorId, index) => predecessorId === right.predecessor_ids[index],
    )
  )
}

function directTaskIds(changeset: ChangeSet): {
  ids: Set<string>
  replacesPlan: boolean
} {
  const ids = new Set<string>()
  let replacesPlan = false
  for (const change of changeset.requested_changes) {
    if (change.type === 'replace_plan' || change.type === 'append_plan') {
      if (change.type === 'replace_plan') replacesPlan = true
      change.tasks.forEach((task) => ids.add(task.internal_id))
    } else {
      ids.add(change.task_id)
    }
  }
  return { ids, replacesPlan }
}

function changeKind(
  currentTask: Task | null,
  proposedTask: Task | null,
): PendingTaskChangeKind {
  if (!currentTask) return 'added'
  if (!proposedTask) return 'removed'
  if (
    currentTask.start_date !== proposedTask.start_date ||
    currentTask.end_date !== proposedTask.end_date
  ) {
    return 'dates'
  }
  return 'details'
}

export function buildPendingPlanPreview(
  currentPlan: PlanState,
  changeset: ChangeSet,
): PendingPlanPreview | null {
  if (!changeset.proposed_plan) return null

  const proposedPlan = changeset.proposed_plan
  const currentById = new Map(
    currentPlan.tasks.map((task) => [task.internal_id, task]),
  )
  const proposedById = new Map(
    proposedPlan.tasks.map((task) => [task.internal_id, task]),
  )
  const impactById = new Map<string, ProposedImpact>(
    changeset.proposed_impacts.map((impact) => [impact.internal_id, impact]),
  )
  const direct = directTaskIds(changeset)
  const orderedIds = [
    ...proposedPlan.tasks.map((task) => task.internal_id),
    ...currentPlan.tasks
      .map((task) => task.internal_id)
      .filter((internalId) => !proposedById.has(internalId)),
  ]

  const changes = orderedIds.flatMap((internalId): PendingTaskPreview[] => {
    const currentTask = currentById.get(internalId) ?? null
    const proposedTask = proposedById.get(internalId) ?? null
    if (currentTask && proposedTask && sameTask(currentTask, proposedTask)) {
      return []
    }
    const impact = impactById.get(internalId)
    const isDirect = direct.ids.has(internalId) ||
      (direct.replacesPlan && proposedTask === null)
    return [{
      internalId,
      publicId: proposedTask?.public_id ?? currentTask?.public_id ?? '',
      name: proposedTask?.name ?? currentTask?.name ?? '',
      currentTask,
      proposedTask,
      kind: changeKind(currentTask, proposedTask),
      source: isDirect ? 'direct' : impact ? 'dependency' : 'related',
      dependencyName: impact?.dependency_name ?? null,
    }]
  })

  return {
    currentPlan,
    proposedPlan,
    changes,
    directCount: changes.filter((change) => change.source === 'direct').length,
    dependencyCount: changes.filter(
      (change) => change.source === 'dependency',
    ).length,
  }
}

function dateParts(value: string): [number, number, number] {
  const [year, month, day] = value.split('-').map(Number)
  return [year, month, day]
}

export function formatPreviewDateRange(start: string, end: string): string {
  const [startYear, startMonth, startDay] = dateParts(start)
  const [endYear, endMonth, endDay] = dateParts(end)
  if (startYear === endYear && startMonth === endMonth) {
    if (startDay === endDay) return `${startDay} ${MONTHS[startMonth - 1]}`
    return `${startDay}–${endDay} ${MONTHS[startMonth - 1]}`
  }
  if (startYear === endYear) {
    return `${startDay} ${MONTHS[startMonth - 1]} – ${endDay} ${MONTHS[endMonth - 1]}`
  }
  return (
    `${startDay} ${MONTHS[startMonth - 1]} ${startYear} – ` +
    `${endDay} ${MONTHS[endMonth - 1]} ${endYear}`
  )
}

function signedWorkingDayDelta(start: string, end: string): number {
  if (start === end) return 0
  const cursor = new Date(`${start}T00:00:00Z`)
  const target = new Date(`${end}T00:00:00Z`)
  const direction = target > cursor ? 1 : -1
  let delta = 0
  while (cursor.getTime() !== target.getTime()) {
    cursor.setUTCDate(cursor.getUTCDate() + direction)
    const weekday = cursor.getUTCDay()
    if (weekday !== 0 && weekday !== 6) delta += direction
  }
  return delta
}

function taskNoun(count: number, singular: string): string {
  const modulo100 = count % 100
  const modulo10 = count % 10
  if (modulo10 === 1 && modulo100 !== 11) return `${count} ${singular}`
  if ([2, 3, 4].includes(modulo10) && ![12, 13, 14].includes(modulo100)) {
    return `${count} задачи`
  }
  return `${count} задач`
}

function taskAccusative(count: number): string {
  return taskNoun(count, 'задачу')
}

function taskNominative(count: number): string {
  return taskNoun(count, 'задача')
}

function workingDays(count: number): string {
  const absolute = Math.abs(count)
  const modulo100 = absolute % 100
  const modulo10 = absolute % 10
  if (modulo10 === 1 && modulo100 !== 11) return `${absolute} рабочий день`
  if ([2, 3, 4].includes(modulo10) && ![12, 13, 14].includes(modulo100)) {
    return `${absolute} рабочих дня`
  }
  return `${absolute} рабочих дней`
}

export function pendingPreviewSummary(preview: PendingPlanPreview): string {
  const directDateChanges = preview.changes.filter(
    (change) => change.source === 'direct' && change.kind === 'dates' &&
      change.currentTask && change.proposedTask,
  )
  const deltas = new Set(
    directDateChanges.map((change) => signedWorkingDayDelta(
      change.currentTask!.start_date,
      change.proposedTask!.start_date,
    )),
  )

  let directSummary: string
  if (directDateChanges.length === preview.directCount && deltas.size === 1) {
    const delta = [...deltas][0]
    if (delta !== 0) {
      directSummary = (
        `Вы переносите ${taskAccusative(preview.directCount)} на ` +
        `${workingDays(delta)} ${delta > 0 ? 'вперёд' : 'назад'}.`
      )
    } else {
      directSummary = `Подготовлено изменений: ${taskNominative(preview.directCount)}.`
    }
  } else if (preview.directCount > 0) {
    directSummary = `Подготовлено прямых изменений: ${taskNominative(preview.directCount)}.`
  } else {
    directSummary = 'Изменения подготовлены к подтверждению.'
  }

  if (preview.dependencyCount === 0) return directSummary
  return (
    `${directSummary} Из-за зависимостей сдвинутся ещё ` +
    `${taskNominative(preview.dependencyCount)}.`
  )
}
