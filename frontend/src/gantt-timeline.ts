import type { GanttTask, GanttViewMode } from 'frappe-gantt'

import type { PlanState } from './types'

export type GanttViewName = 'Day' | 'Week' | 'Month'

export type TimelineBounds = {
  start: string
  end: string
}

export type TimelineSizing = {
  columnCount: number
  columnWidth: number
  timelineWidth: number
  scrollable: boolean
}

const MIN_COLUMN_WIDTH: Record<GanttViewName, number> = {
  Day: 45,
  Week: 140,
  Month: 120,
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000

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

function calendarDaysInclusive(start: string, end: string): number {
  const startDate = parseIsoDate(start)
  const endDate = parseIsoDate(end)
  const startUtc = Date.UTC(
    startDate.getFullYear(),
    startDate.getMonth(),
    startDate.getDate(),
  )
  const endUtc = Date.UTC(
    endDate.getFullYear(),
    endDate.getMonth(),
    endDate.getDate(),
  )
  return Math.round((endUtc - startUtc) / MILLISECONDS_PER_DAY) + 1
}

function calendarDaysBetween(start: Date, end: Date): number {
  const startUtc = Date.UTC(
    start.getFullYear(),
    start.getMonth(),
    start.getDate(),
  )
  const endUtc = Date.UTC(
    end.getFullYear(),
    end.getMonth(),
    end.getDate(),
  )
  return Math.round((endUtc - startUtc) / MILLISECONDS_PER_DAY)
}

function startOfMonth(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), 1, 12)
}

function monthsBetween(start: Date, end: Date): number {
  return (
    (end.getFullYear() - start.getFullYear()) * 12 +
    end.getMonth() - start.getMonth()
  )
}

function timelineColumnCount(
  plan: PlanState,
  viewMode: GanttViewName,
): number {
  const bounds = projectTimelineBounds(plan, viewMode)
  if (!bounds) return 1
  if (viewMode === 'Day') {
    return calendarDaysInclusive(bounds.start, bounds.end)
  }
  if (viewMode === 'Week') {
    return Math.max(1, Math.ceil(
      calendarDaysInclusive(bounds.start, bounds.end) / 7,
    ))
  }
  const start = parseIsoDate(bounds.start)
  const end = parseIsoDate(bounds.end)
  return (
    (end.getFullYear() - start.getFullYear()) * 12 +
    end.getMonth() - start.getMonth() + 1
  )
}

export function timelineSizing(
  plan: PlanState,
  viewMode: GanttViewName,
  viewportWidth: number,
): TimelineSizing {
  const columnCount = timelineColumnCount(plan, viewMode)
  const minimumWidth = MIN_COLUMN_WIDTH[viewMode]
  const availableWidth = Number.isFinite(viewportWidth)
    ? Math.max(0, Math.floor(viewportWidth))
    : 0
  const minimumTimelineWidth = columnCount * minimumWidth
  const columnWidth = Math.max(
    minimumWidth,
    availableWidth > 0 ? Math.ceil(availableWidth / columnCount) : 0,
  )
  return {
    columnCount,
    columnWidth,
    timelineWidth: columnCount * columnWidth,
    scrollable: availableWidth > 0 && minimumTimelineWidth > availableWidth,
  }
}

function monthHeading(value: Date, previous: Date | null): string {
  if (previous && previous.getMonth() === value.getMonth()) return ''
  return `${MONTHS_LONG[value.getMonth()]} ${value.getFullYear()}`
}

function timelinePadding(
  timelinePlan: PlanState,
  renderedPlan: PlanState,
  viewMode: GanttViewName,
): [string, string] {
  const target = projectTimelineBounds(timelinePlan, viewMode)
  const rendered = planBounds(renderedPlan)
  if (!target || !rendered) {
    if (viewMode === 'Day') return ['3d', '2d']
    if (viewMode === 'Week') return ['7d', '6d']
    return ['1m', '1m']
  }

  const renderedStart = parseIsoDate(rendered.start)
  const renderedEndExclusive = addDays(parseIsoDate(rendered.end), 1)
  const targetStart = parseIsoDate(target.start)
  const targetEnd = parseIsoDate(target.end)

  if (viewMode === 'Month') {
    const startPadding = Math.max(0, monthsBetween(
      startOfMonth(targetStart),
      startOfMonth(renderedStart),
    ))
    const endPadding = Math.max(0, monthsBetween(
      startOfMonth(renderedEndExclusive),
      startOfMonth(targetEnd),
    ))
    return [`${startPadding}m`, `${endPadding}m`]
  }

  const targetLastColumn = viewMode === 'Week'
    ? startOfIsoWeek(targetEnd)
    : targetEnd
  const startPadding = Math.max(
    0,
    calendarDaysBetween(targetStart, renderedStart),
  )
  const endPadding = Math.max(
    0,
    calendarDaysBetween(renderedEndExclusive, targetLastColumn),
  )
  return [`${startPadding}d`, `${endPadding}d`]
}

export function ganttViewModes(
  plan: PlanState,
  viewportWidth = 0,
  renderedPlan = plan,
): GanttViewMode[] {
  return [
    {
      name: 'Day',
      padding: timelinePadding(plan, renderedPlan, 'Day'),
      step: '1d',
      date_format: 'YYYY-MM-DD',
      column_width: timelineSizing(plan, 'Day', viewportWidth).columnWidth,
      lower_text: (date) => String(date.getDate()),
      upper_text: (date, previous) => monthHeading(date, previous),
      thick_line: (date) => date.getDay() === 1,
    },
    {
      name: 'Week',
      padding: timelinePadding(plan, renderedPlan, 'Week'),
      step: '7d',
      date_format: 'YYYY-MM-DD',
      column_width: timelineSizing(plan, 'Week', viewportWidth).columnWidth,
      lower_text: (date) => formatCalendarWeek(date),
      upper_text: (date, previous) => monthHeading(date, previous),
      thick_line: (date) => date.getDate() <= 7,
      snap_at: '1d',
    },
    {
      name: 'Month',
      padding: timelinePadding(plan, renderedPlan, 'Month'),
      step: '1m',
      date_format: 'YYYY-MM',
      column_width: timelineSizing(plan, 'Month', viewportWidth).columnWidth,
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
