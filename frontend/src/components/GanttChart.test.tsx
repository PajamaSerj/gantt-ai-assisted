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
  constructorCount: number
  constructorTaskCounts: number[]
  refreshCount: number
  updateCalls: Array<{ id: string; start?: string; end?: string }>
} => ({
  options: null,
  tasks: [],
  viewChanges: [],
  constructorCount: 0,
  constructorTaskCounts: [],
  refreshCount: 0,
  updateCalls: [],
}))

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
    private container: HTMLElement

    constructor(
      container: HTMLElement,
      tasks: GanttTask[],
      options: GanttOptions,
    ) {
      this.container = container
      ganttMock.options = options
      ganttMock.tasks = tasks.map((task) => ({ ...task }))
      ganttMock.constructorCount += 1
      ganttMock.constructorTaskCounts.push(tasks.length)
      container.innerHTML = (
        '<div class="gantt-container"><svg class="gantt">' +
        tasks.map((task) => (
          `<g class="bar-wrapper" data-id="${task.id}">` +
          `<rect class="bar" width="100" data-start="${task.start}" data-end="${task.end}">` +
          '<animate attributeName="width" from="0" to="100"></animate>' +
          '</rect>' +
          '<rect class="handle left"></rect>' +
          '<rect class="handle right"></rect>' +
          '</g>'
        )).join('') +
        '</svg></div>'
      )
    }

    refresh(tasks: GanttTask[]): void {
      ganttMock.refreshCount += 1
      ganttMock.tasks = tasks.map((task) => ({ ...task }))
    }

    update_task(
      id: string,
      details: Partial<GanttTask> & { _start?: Date; _end?: Date },
    ): void {
      const task = ganttMock.tasks.find((candidate) => candidate.id === id)
      if (task) Object.assign(task, details)
      ganttMock.updateCalls.push({
        id,
        start: details.start,
        end: details.end,
      })
      const bar = this.container.querySelector<SVGRectElement>(
        `.bar-wrapper[data-id="${id}"] .bar`,
      )
      if (!bar) return
      if (details.start) bar.dataset.start = details.start
      if (details.end) bar.dataset.end = details.end
      bar.innerHTML = (
        '<animate attributeName="width" from="0" to="100"></animate>'
      )
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
  ganttMock.options = null
  ganttMock.tasks = []
  ganttMock.viewChanges = []
  ganttMock.constructorCount = 0
  ganttMock.constructorTaskCounts = []
  ganttMock.refreshCount = 0
  ganttMock.updateCalls = []
  resizeMock.callback = null
  resizeMock.target = null
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
})

afterEach(() => vi.unstubAllGlobals())

describe('interactive Gantt integration', () => {
  it('keeps one Gantt instance when only direct-edit busy state changes', () => {
    const first = renderChart()
    const firstCanvas = first.container.querySelector('svg.gantt')
    const blockedDirectEdit = vi.fn()

    first.rerender(<GanttChart
      {...first.props}
      interactionBusy
      onDirectEdit={blockedDirectEdit}
      onTaskSelect={vi.fn()}
    />)

    expect(ganttMock.constructorCount).toBe(1)
    expect(first.container.querySelector('svg.gantt')).toBe(firstCanvas)
    expect(first.container.querySelector('.gantt-host')).toHaveClass(
      'gantt-direct-edit-busy',
    )
    act(() => {
      ganttMock.options?.on_date_change?.(
        ganttMock.tasks[0],
        new Date(2026, 1, 3, 12),
        new Date(2026, 1, 5, 12),
      )
      document.dispatchEvent(new MouseEvent('mouseup'))
    })
    expect(blockedDirectEdit).not.toHaveBeenCalled()

    first.rerender(<GanttChart {...first.props} interactionBusy={false} />)
    expect(ganttMock.constructorCount).toBe(1)
    expect(first.container.querySelector('svg.gantt')).toBe(firstCanvas)
  })

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

  it('keeps other bars and one chart instance through a safe applied move', async () => {
    const { current } = makeSergeyPendingScenario()
    let completeRequest: () => void = () => undefined
    const request = new Promise<void>((resolve) => {
      completeRequest = resolve
    })
    const onDirectEdit = vi.fn(() => request)
    const chart = renderChart({ plan: current, onDirectEdit })
    const untouchedBar = chart.container.querySelector(
      '.bar-wrapper[data-id="TASK-001"]',
    )
    const moved = ganttMock.tasks[6]
    moved.start = '2026-02-28'
    moved.end = '2026-03-03'

    act(() => {
      ganttMock.options?.on_date_change?.(
        moved,
        new Date(2026, 1, 28, 12),
        new Date(2026, 2, 3, 12),
      )
      document.dispatchEvent(new MouseEvent('mouseup'))
    })
    chart.rerender(<GanttChart
      {...chart.props}
      plan={current}
      interactionBusy
      onDirectEdit={onDirectEdit}
    />)

    const applied = structuredClone(current)
    applied.tasks[6] = {
      ...applied.tasks[6],
      start_date: '2026-03-02',
      end_date: '2026-03-03',
    }
    chart.rerender(<GanttChart
      {...chart.props}
      plan={applied}
      interactionBusy={false}
      onDirectEdit={onDirectEdit}
    />)
    await act(async () => {
      completeRequest()
      await new Promise((resolve) => window.setTimeout(resolve, 30))
    })

    expect(ganttMock.constructorCount).toBe(1)
    expect(ganttMock.refreshCount).toBe(0)
    expect(chart.container.querySelector(
      '.bar-wrapper[data-id="TASK-001"]',
    )).toBe(untouchedBar)
    expect(ganttMock.updateCalls.every((call) => call.id === 'TASK-007')).toBe(true)
    expect(ganttMock.tasks[6]).toMatchObject({
      start: '2026-03-02',
      end: '2026-03-03',
    })
    expect(chart.container.querySelector('animate')).not.toBeInTheDocument()
  })

  it('restores only the authoritative task after an invalid direct move', async () => {
    const { current } = makeSergeyPendingScenario()
    const snapshot = structuredClone(current)
    let completeRequest: () => void = () => undefined
    const request = new Promise<void>((resolve) => {
      completeRequest = resolve
    })
    const onDirectEdit = vi.fn(() => request)
    const chart = renderChart({ plan: current, onDirectEdit })
    const untouchedBar = chart.container.querySelector(
      '.bar-wrapper[data-id="TASK-006"]',
    )
    const moved = ganttMock.tasks[6]
    moved.start = '2026-02-26'
    moved.end = '2026-02-27'
    const movedBar = chart.container.querySelector<SVGRectElement>(
      '.bar-wrapper[data-id="TASK-007"] .bar',
    )
    if (!movedBar) throw new Error('Expected TASK-007 bar')
    movedBar.dataset.start = moved.start
    movedBar.dataset.end = moved.end

    act(() => {
      ganttMock.options?.on_date_change?.(
        moved,
        new Date(2026, 1, 26, 12),
        new Date(2026, 1, 27, 12),
      )
      document.dispatchEvent(new MouseEvent('mouseup'))
    })
    chart.rerender(<GanttChart
      {...chart.props}
      interactionBusy
      onDirectEdit={onDirectEdit}
    />)
    chart.rerender(<GanttChart
      {...chart.props}
      interactionBusy={false}
      onDirectEdit={onDirectEdit}
    />)
    await act(async () => {
      completeRequest()
      await new Promise((resolve) => window.setTimeout(resolve, 30))
    })

    expect(current).toEqual(snapshot)
    expect(ganttMock.constructorCount).toBe(1)
    expect(ganttMock.refreshCount).toBe(0)
    expect(chart.container.querySelector(
      '.bar-wrapper[data-id="TASK-006"]',
    )).toBe(untouchedBar)
    expect(movedBar.dataset.start).toBe('2026-02-27')
    expect(movedBar.dataset.end).toBe('2026-03-02')
    expect(chart.container.querySelector('.gantt-host')).not.toHaveClass(
      'gantt-direct-edit-busy',
    )
  })

  it('renders a non-empty settled pending preview after confirmation', async () => {
    const { current, changeset } = makeSergeyPendingScenario()
    let completeRequest: () => void = () => undefined
    const request = new Promise<void>((resolve) => {
      completeRequest = resolve
    })
    const onDirectEdit = vi.fn(() => request)
    const chart = renderChart({ plan: current, onDirectEdit })

    act(() => {
      ganttMock.options?.on_date_change?.(
        ganttMock.tasks[4],
        new Date(2026, 1, 20, 12),
        new Date(2026, 1, 24, 12),
      )
      document.dispatchEvent(new MouseEvent('mouseup'))
    })
    chart.rerender(<GanttChart
      {...chart.props}
      plan={current}
      interactionBusy
      onDirectEdit={onDirectEdit}
    />)

    const preview = buildPendingPlanPreview(current, changeset)
    chart.rerender(<GanttChart
      {...chart.props}
      plan={current}
      preview={preview}
      interactionDisabled
      interactionBusy={false}
      onDirectEdit={onDirectEdit}
    />)
    await act(async () => {
      completeRequest()
      await new Promise((resolve) => window.setTimeout(resolve, 30))
    })

    expect(ganttMock.constructorTaskCounts).toEqual([7, 11])
    expect(ganttMock.constructorTaskCounts).not.toContain(0)
    expect(ganttMock.refreshCount).toBe(0)
    expect(chart.container.querySelectorAll('.bar-wrapper')).toHaveLength(11)
    expect(chart.container.querySelector('animate')).not.toBeInTheDocument()
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
