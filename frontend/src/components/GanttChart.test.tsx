import { act, render } from '@testing-library/react'
import type { GanttOptions, GanttTask } from 'frappe-gantt'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildPendingPlanPreview } from '../pending-preview'
import { makePlan, makeSergeyPendingScenario } from '../test/fixtures'
import { GanttChart } from './GanttChart'

const ganttMock = vi.hoisted((): {
  options: GanttOptions | null
  tasks: GanttTask[]
  viewChanges: Array<{ mode: string; maintainPosition: boolean }>
} => ({ options: null, tasks: [], viewChanges: [] }))

const resizeMock = vi.hoisted((): {
  callback: ResizeObserverCallback | null
  target: Element | null
} => ({ callback: null, target: null }))

class ResizeObserverMock implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeMock.callback = callback
  }

  observe(target: Element): void {
    resizeMock.target = target
  }

  disconnect(): void {}
  unobserve(): void {}
}

vi.mock('frappe-gantt', () => ({
  default: class MockGantt {
    constructor(
      container: HTMLElement,
      tasks: GanttTask[],
      options: GanttOptions,
    ) {
      ganttMock.options = options
      ganttMock.tasks = tasks
      container.innerHTML = (
        '<div class="gantt-container"><svg class="gantt">' +
        '<rect class="handle left"></rect>' +
        '<rect class="handle right"></rect>' +
        '</svg></div>'
      )
    }

    refresh(tasks: GanttTask[]): void {
      ganttMock.tasks = tasks
    }

    change_view_mode(mode: string, maintainPosition: boolean): void {
      ganttMock.viewChanges.push({ mode, maintainPosition })
    }
  },
}))

function renderChart(overrides: Partial<ComponentProps<typeof GanttChart>> = {}) {
  ganttMock.viewChanges = []
  const plan = makePlan()
  const props: ComponentProps<typeof GanttChart> = {
    plan,
    preview: null,
    affectedPublicIds: new Set(),
    viewMode: 'Week',
    scrollToStartToken: 1,
    interactionDisabled: false,
    interactionBusy: false,
    onTaskSelect: vi.fn(),
    onDirectEdit: vi.fn(),
    ...overrides,
  }
  return { ...render(<GanttChart {...props} />), plan, props }
}

function resizeChart(width: number): void {
  if (!resizeMock.callback || !resizeMock.target) {
    throw new Error('Gantt ResizeObserver is not connected')
  }
  const entry = {
    target: resizeMock.target,
    contentRect: { width },
  } as ResizeObserverEntry
  act(() => resizeMock.callback?.([entry], {} as ResizeObserver))
}

beforeEach(() => {
  resizeMock.callback = null
  resizeMock.target = null
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
})

afterEach(() => vi.unstubAllGlobals())

describe('interactive Gantt integration', () => {
  it('keeps a plain task click opening details and hides left resize', () => {
    const { container, props } = renderChart()

    act(() => ganttMock.options?.on_click?.(ganttMock.tasks[0]))

    expect(props.onTaskSelect).toHaveBeenCalledWith(props.plan.tasks[0])
    expect(props.onDirectEdit).not.toHaveBeenCalled()
    const left = container.querySelector<SVGElement>('.handle.left')
    const right = container.querySelector<SVGElement>('.handle.right')
    expect(left?.style.pointerEvents).toBe('none')
    expect(right?.style.pointerEvents).toBe('')
    expect(ganttMock.viewChanges).toContainEqual({
      mode: 'Week',
      maintainPosition: false,
    })
  })

  it('emits one move intent on drop and never mutates PlanState directly', () => {
    const { plan, props } = renderChart()
    const snapshot = structuredClone(plan)

    act(() => {
      ganttMock.options?.on_date_change?.(
        ganttMock.tasks[0],
        new Date(2026, 1, 3, 12),
        new Date(2026, 1, 5, 12),
      )
      document.dispatchEvent(new MouseEvent('mouseup'))
    })

    expect(props.onDirectEdit).toHaveBeenCalledTimes(1)
    expect(props.onDirectEdit).toHaveBeenCalledWith({
      type: 'move',
      task: plan.tasks[0],
      intendedDate: '2026-02-03',
    })
    expect(plan).toEqual(snapshot)
    act(() => ganttMock.options?.on_click?.(ganttMock.tasks[0]))
    expect(props.onTaskSelect).not.toHaveBeenCalled()
  })

  it('snaps a Friday drag to Monday before emitting the direct-edit intent', () => {
    const { current } = makeSergeyPendingScenario()
    const { props } = renderChart({ plan: current })

    act(() => {
      ganttMock.options?.on_date_change?.(
        ganttMock.tasks[6],
        new Date(2026, 1, 28, 12),
        new Date(2026, 2, 3, 12),
      )
      document.dispatchEvent(new MouseEvent('mouseup'))
    })

    expect(props.onDirectEdit).toHaveBeenCalledWith({
      type: 'move',
      task: current.tasks[6],
      intendedDate: '2026-03-02',
    })
  })

  it('emits a duration resize from a right-edge end change', () => {
    const { plan, props } = renderChart()

    act(() => {
      ganttMock.options?.on_date_change?.(
        ganttMock.tasks[0],
        new Date(2026, 1, 2, 12),
        new Date(2026, 1, 6, 12),
      )
      document.dispatchEvent(new MouseEvent('mouseup'))
    })

    expect(props.onDirectEdit).toHaveBeenCalledWith({
      type: 'resize',
      task: plan.tasks[0],
      intendedDate: '2026-02-06',
    })
  })

  it('disables drag and resize whenever a pending ChangeSet exists', () => {
    const { current, changeset } = makeSergeyPendingScenario()
    const preview = buildPendingPlanPreview(current, changeset)
    renderChart({ plan: current, preview, interactionDisabled: true })

    expect(ganttMock.options?.readonly).toBe(true)
    expect(ganttMock.options?.readonly_dates).toBe(true)
  })

  it('rebuilds viewport-filling columns when the Gantt container changes width', () => {
    const { current } = makeSergeyPendingScenario()
    const { container } = renderChart({ plan: current })

    resizeChart(1600)
    const wideWeek = ganttMock.options?.view_modes?.find(
      (mode) => mode.name === 'Week',
    )
    expect(wideWeek?.column_width).toBe(229)
    expect((wideWeek?.column_width ?? 0) * 7).toBeGreaterThanOrEqual(1600)

    resizeChart(1100)
    const drawerOpenWeek = ganttMock.options?.view_modes?.find(
      (mode) => mode.name === 'Week',
    )
    expect(drawerOpenWeek?.column_width).toBe(158)
    expect((drawerOpenWeek?.column_width ?? 0) * 7).toBeGreaterThanOrEqual(1100)
    expect(container.querySelector('[data-viewport-width="1100"]')).not.toBeNull()
  })
})
