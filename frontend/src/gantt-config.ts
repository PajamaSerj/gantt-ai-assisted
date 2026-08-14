import type { GanttOptions } from 'frappe-gantt'

import { isWeekendDate } from './gantt-timeline'

export const GANTT_SAFETY_OPTIONS = Object.freeze({
  readonly_progress: true,
  move_dependencies: false,
  infinite_padding: false,
  language: 'ru',
  fixed_duration: false,
  is_weekend: isWeekendDate,
  holidays: { 'rgba(85, 96, 113, 0.07)': 'weekend' as const },
}) satisfies Readonly<GanttOptions>

export function ganttInteractionOptions(
  disabled: boolean,
): Pick<GanttOptions, 'readonly' | 'readonly_dates'> {
  return {
    readonly: disabled,
    readonly_dates: disabled,
  }
}
