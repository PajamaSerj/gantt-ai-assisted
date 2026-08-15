import { describe, expect, it } from 'vitest'

import {
  formatCalendarWeek,
  ganttViewModes,
  isWeekendDate,
  projectTimelineBounds,
  timelineSizing,
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

  it('fills a wide viewport for a short bounded plan with uniform columns', () => {
    const { current } = makeSergeyPendingScenario()

    expect(timelineSizing(current, 'Week', 1600)).toEqual({
      columnCount: 7,
      columnWidth: 229,
      timelineWidth: 1603,
      scrollable: false,
    })
    const modes = ganttViewModes(current, 1600)
    expect(modes.find((mode) => mode.name === 'Day')?.column_width).toBe(46)
    expect(modes.find((mode) => mode.name === 'Week')?.column_width).toBe(229)
    expect(modes.find((mode) => mode.name === 'Month')?.column_width).toBe(400)
  })

  it('keeps readable minimum columns and scrolling for a long plan', () => {
    const { current } = makeSergeyPendingScenario()
    const longPlan = {
      tasks: current.tasks.map((task, index) => index === current.tasks.length - 1
        ? { ...task, end_date: '2027-03-02' }
        : task),
    }

    const sizing = timelineSizing(longPlan, 'Week', 1200)

    expect(sizing.columnWidth).toBe(140)
    expect(sizing.timelineWidth).toBeGreaterThan(1200)
    expect(sizing.scrollable).toBe(true)
  })

  it('extends padding from rendered tasks through a far proposed range', () => {
    const { current } = makeSergeyPendingScenario()
    const proposed = {
      tasks: current.tasks.map((task, index) => {
        if (index === 5) {
          return { ...task, start_date: '2026-03-12', end_date: '2026-03-23' }
        }
        if (index === 6) {
          return { ...task, start_date: '2026-03-24', end_date: '2026-03-25' }
        }
        return task
      }),
    }
    const timelinePlan = { tasks: [...current.tasks, ...proposed.tasks] }
    const week = ganttViewModes(timelinePlan, 454, current).find(
      (mode) => mode.name === 'Week',
    )

    expect(week?.padding).toEqual(['7d', '27d'])
  })
})
