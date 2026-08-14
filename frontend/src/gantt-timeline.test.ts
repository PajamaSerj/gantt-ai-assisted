import { describe, expect, it } from 'vitest'

import {
  formatCalendarWeek,
  ganttViewModes,
  isWeekendDate,
  projectTimelineBounds,
} from './gantt-timeline'
import { makeSergeyPendingScenario } from './test/fixtures'

describe('Gantt timeline presentation', () => {
  it('keeps a small project-derived range in every supported view', () => {
    const { current } = makeSergeyPendingScenario()

    expect(projectTimelineBounds(current, 'Day')).toEqual({
      start: '2026-01-30',
      end: '2026-03-05',
    })
    expect(projectTimelineBounds(current, 'Week')).toEqual({
      start: '2026-01-26',
      end: '2026-03-15',
    })
    expect(projectTimelineBounds(current, 'Month')).toEqual({
      start: '2026-01-01',
      end: '2026-04-30',
    })
  })

  it('aligns week columns to Monday-Sunday and formats Russian ranges', () => {
    expect(formatCalendarWeek(new Date(2026, 0, 26, 12))).toBe(
      '26 янв. – 1 февр.',
    )
    expect(formatCalendarWeek(new Date(2026, 1, 2, 12))).toBe('2–8 февр.')
    expect(formatCalendarWeek(new Date(2026, 1, 23, 12))).toBe(
      '23 февр. – 1 мар.',
    )

    const { current } = makeSergeyPendingScenario()
    const week = ganttViewModes(current).find((mode) => mode.name === 'Week')
    expect(week?.padding).toEqual(['7d', '6d'])
    expect(week?.snap_at).toBe('1d')
  })

  it('maps only Saturday and Sunday to weekend visualization', () => {
    expect(isWeekendDate(new Date(2026, 1, 6, 12))).toBe(false)
    expect(isWeekendDate(new Date(2026, 1, 7, 12))).toBe(true)
    expect(isWeekendDate(new Date(2026, 1, 8, 12))).toBe(true)
    expect(isWeekendDate(new Date(2026, 1, 9, 12))).toBe(false)
  })
})
