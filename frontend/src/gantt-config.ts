import type { GanttOptions } from 'frappe-gantt'

export const GANTT_SAFETY_OPTIONS = Object.freeze({
  readonly: true,
  readonly_dates: true,
  readonly_progress: true,
  move_dependencies: false,
  infinite_padding: false,
  language: 'ru',
}) satisfies Readonly<GanttOptions>
