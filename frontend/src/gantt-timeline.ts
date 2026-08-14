import type { GanttTask, GanttViewMode } from 'frappe-gantt'

import type { PlanState } from './types'

export type GanttViewName = 'Day' | 'Week' | 'Month'

export type TimelineBounds = {
  start: string
  end: string
}

const MONTHS_SHORT = [
  'янв.',
  'февр.',
  'мар.',
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

const MONTHS_LONG = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
] as const

function parseIsoDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day, 12)
}

function isoDate(value: Date): string {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-')
}

function addDays(value: Date, days: number): Date {
  const result = new Date(value)
  result.setDate(result.getDate() + days)
  return result
}

function startOfIsoWeek(value: Date): Date {
  const mondayOffset = (value.getDay() + 6) % 7
  return addDays(value, -mondayOffset)
}

function endOfIsoWeek(value: Date): Date {
  return addDays(startOfIsoWeek(value), 6)
}

function planBounds(plan: PlanState): TimelineBounds | null {
  if (plan.tasks.length === 0) return null
  return {
    start: plan.tasks.reduce(
      (minimum, task) => task.start_date < minimum ? task.start_date : minimum,
      plan.tasks[0].start_date,
    ),
    end: plan.tasks.reduce(
      (maximum, task) => task.end_date > maximum ? task.end_date : maximum,
      plan.tasks[0].end_date,
    ),
  }
}

export function projectTimelineBounds(
  plan: PlanState,
  viewMode: GanttViewName,
): TimelineBounds | null {
  const bounds = planBounds(plan)
  if (!bounds) return null
  const start = parseIsoDate(bounds.start)
  const end = parseIsoDate(bounds.end)
  if (viewMode === 'Day') {
    return { start: isoDate(addDays(start, -3)), end: isoDate(addDays(end, 3)) }
  }
  if (viewMode === 'Week') {
    return {
      start: isoDate(addDays(startOfIsoWeek(start), -7)),
      end: isoDate(addDays(endOfIsoWeek(end), 7)),
    }
  }
  return {
    start: isoDate(new Date(start.getFullYear(), start.getMonth() - 1, 1, 12)),
    end: isoDate(new Date(end.getFullYear(), end.getMonth() + 2, 0, 12)),
  }
}

export function formatCalendarWeek(monday: Date): string {
  const sunday = addDays(monday, 6)
  if (monday.getMonth() === sunday.getMonth()) {
    return `${monday.getDate()}–${sunday.getDate()} ${MONTHS_SHORT[monday.getMonth()]}`
  }
  return (
    `${monday.getDate()} ${MONTHS_SHORT[monday.getMonth()]} – ` +
    `${sunday.getDate()} ${MONTHS_SHORT[sunday.getMonth()]}`
  )
}

export function isWeekendDate(value: Date): boolean {
  return value.getDay() === 0 || value.getDay() === 6
}

function monthHeading(value: Date, previous: Date | null): string {
  if (previous && previous.getMonth() === value.getMonth()) return ''
  return `${MONTHS_LONG[value.getMonth()]} ${value.getFullYear()}`
}

function weekPadding(plan: PlanState): [string, string] {
  const bounds = planBounds(plan)
  if (!bounds) return ['7d', '6d']
  const start = parseIsoDate(bounds.start)
  const end = parseIsoDate(bounds.end)
  const daysSinceMonday = (start.getDay() + 6) % 7
  const endDaysSinceMonday = (end.getDay() + 6) % 7
  return [`${7 + daysSinceMonday}d`, `${6 - endDaysSinceMonday}d`]
}

export function ganttViewModes(plan: PlanState): GanttViewMode[] {
  return [
    {
      name: 'Day',
      padding: ['3d', '2d'],
      step: '1d',
      date_format: 'YYYY-MM-DD',
      lower_text: (date) => String(date.getDate()),
      upper_text: (date, previous) => monthHeading(date, previous),
      thick_line: (date) => date.getDay() === 1,
    },
    {
      name: 'Week',
      padding: weekPadding(plan),
      step: '7d',
      date_format: 'YYYY-MM-DD',
      column_width: 140,
      lower_text: (date) => formatCalendarWeek(date),
      upper_text: (date, previous) => monthHeading(date, previous),
      thick_line: (date) => date.getDate() <= 7,
      snap_at: '1d',
    },
    {
      name: 'Month',
      padding: ['1m', '1m'],
      step: '1m',
      date_format: 'YYYY-MM',
      column_width: 120,
      lower_text: (date) => MONTHS_SHORT[date.getMonth()],
      upper_text: (date, previous) =>
        !previous || previous.getFullYear() !== date.getFullYear()
          ? String(date.getFullYear())
          : '',
      thick_line: (date) => date.getMonth() % 3 === 0,
      snap_at: '1d',
    },
  ]
}

export function ganttTimelinePlan(
  currentPlan: PlanState,
  proposedPlan: PlanState | null,
): PlanState {
  if (!proposedPlan) return currentPlan
  const tasks = new Map(
    currentPlan.tasks.map((task) => [`current-${task.internal_id}`, task]),
  )
  proposedPlan.tasks.forEach((task) => tasks.set(`proposed-${task.internal_id}`, task))
  return { tasks: [...tasks.values()] }
}

export function ganttTaskBounds(tasks: GanttTask[]): TimelineBounds | null {
  if (tasks.length === 0) return null
  return {
    start: tasks.reduce(
      (minimum, task) => task.start < minimum ? task.start : minimum,
      tasks[0].start,
    ),
    end: tasks.reduce(
      (maximum, task) => task.end > maximum ? task.end : maximum,
      tasks[0].end,
    ),
  }
}
