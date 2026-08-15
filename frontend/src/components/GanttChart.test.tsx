import { act, fireEvent, render } from '@testing-library/react'
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

class PointerEventMock extends MouseEvent {
  readonly pointerId: number
  readonly isPrimary: boolean

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 0
    this.isPrimary = init.isPrimary ?? true
  }
}

vi.mock('frappe-gantt', () => ({
  default: class MockGantt {
    private container: HTMLElement
    gantt_start = new Date(2026, 0, 1)
    config = { unit: 'day', step: 7, column_width: 140 }

    private dateX(value: string): number {
      const [year, month, day] = value.split('-').map(Number)
      const date = new Date(year, month - 1, day)
      const days = Math.round(
        (date.getTime() - this.gantt_start.getTime()) / 86_400_000,
      )
      return days / this.config.step * this.config.column_width
    }

    private barWidth(start: string, end: string): number {
      return this.dateX(end) - this.dateX(start) +
        this.config.column_width / this.config.step
    }

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
        '<div class="gantt-container"><svg class="gantt" width="1600" height="459">' +
        '<g class="grid"><rect class="grid-row" width="1600"></rect></g>' +
        tasks.map((task, index) => (
          `<g class="bar-wrapper" data-id="${task.id}">` +
          '<g class="bar-group">' +
          `<rect class="bar" x="${this.dateX(task.start)}" ` +
          `y="${95 + index * 52}" width="${this.barWidth(task.start, task.end)}" ` +
          `height="32" data-start="${task.start}" data-end="${task.end}">` +
          '<animate attributeName="width" from="0" to="100"></animate>' +
          '</rect>' +
          `<text class="bar-label big" x="${this.dateX(task.start) + this.barWidth(task.start, task.end) + 5}" ` +
          `y="${111 + index * 52}">${task.name}</text></g>` +
          '<rect class="handle left"></rect>' +
          '<rect class="handle right"></rect>' +
          '</g>'
        )).join('') +
        '</svg></div>'
      )
      ganttMock.tasks.forEach((task) => {
        container.querySelector(
          `.bar-wrapper[data-id="${task.id}"]`,
        )?.addEventListener('click', () => options.on_click?.(task))
      })
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
      if (details.start) bar.setAttribute('x', String(this.dateX(details.start)))
      if (details.start && details.end) {
        bar.setAttribute(
          'width',
          String(this.barWidth(details.start, details.end)),
        )
      }
      bar.innerHTML = (
        '<animate attributeName="width" from="0" to="100"></animate>'
      )
    }

    change_view_mode(mode: string, maintainPosition: boolean): void {
      ganttMock.viewChanges.push({ mode, maintainPosition })
      if (mode === 'Day') this.config = { unit: 'day', step: 1, column_width: 45 }
      if (mode === 'Week') this.config = { unit: 'day', step: 7, column_width: 140 }
      if (mode === 'Month') {
        this.config = { unit: 'month', step: 1, column_width: 120 }
      }
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

function taskPart(
  container: HTMLElement,
  taskPublicId: string,
  selector = '.bar-wrapper',
): Element {
  const element = container.querySelector(
    `.bar-wrapper[data-id="${taskPublicId}"] ${selector === '.bar-wrapper' ? '' : selector}`.trim(),
  )
  if (!element) throw new Error(`Expected ${selector} for ${taskPublicId}`)
  return element
}

function pointerGesture(
  target: Element,
  start: { x: number; y: number },
  end = start,
  pointerId = 1,
): void {
  fireEvent.pointerDown(target, {
    pointerId,
    button: 0,
    isPrimary: true,
    clientX: start.x,
    clientY: start.y,
  })
  if (end.x !== start.x || end.y !== start.y) {
    fireEvent.pointerMove(target, {
      pointerId,
      isPrimary: true,
      clientX: end.x,
      clientY: end.y,
    })
  }
  fireEvent.pointerUp(target, {
    pointerId,
    button: 0,
    isPrimary: true,
    clientX: end.x,
    clientY: end.y,
  })
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
  vi.stubGlobal('PointerEvent', PointerEventMock)
  Object.defineProperty(SVGElement.prototype, 'getComputedTextLength', {
    configurable: true,
    value(this: SVGElement) {
      return (this.textContent?.length ?? 0) * 6
    },
  })
})

afterEach(() => {
  delete (SVGElement.prototype as SVGElement & {
    getComputedTextLength?: () => number
  }).getComputedTextLength
  vi.unstubAllGlobals()
})

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
    const task = taskPart(container, 'TASK-001')

    pointerGesture(task, { x: 100, y: 110 })
    fireEvent.click(task)
    act(() => ganttMock.options?.on_click?.(ganttMock.tasks[0]))

    expect(props.onTaskSelect).toHaveBeenCalledTimes(1)
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

  it('consumes an unchanged micro-drag and lets the next click open details', () => {
    const { container, props } = renderChart()
    const task = taskPart(container, 'TASK-001')

    pointerGesture(task, { x: 100, y: 110 }, { x: 104, y: 110 })
    fireEvent.click(task)
    act(() => ganttMock.options?.on_click?.(ganttMock.tasks[0]))

    expect(props.onDirectEdit).not.toHaveBeenCalled()
    expect(props.onTaskSelect).not.toHaveBeenCalled()

    pointerGesture(task, { x: 100, y: 110 })
    fireEvent.click(task)
    act(() => ganttMock.options?.on_click?.(ganttMock.tasks[0]))

    expect(props.onTaskSelect).toHaveBeenCalledTimes(1)
    expect(props.onTaskSelect).toHaveBeenCalledWith(props.plan.tasks[0])
  })

  it('keeps delayed clicks suppressed through a real drag request', async () => {
    let completeRequest: () => void = () => undefined
    const request = new Promise<void>((resolve) => {
      completeRequest = resolve
    })
    const onDirectEdit = vi.fn(() => request)
    const chart = renderChart({ onDirectEdit })
    const task = taskPart(chart.container, 'TASK-001')

    pointerGesture(task, { x: 100, y: 110 }, { x: 112, y: 110 })
    act(() => {
      ganttMock.options?.on_date_change?.(
        ganttMock.tasks[0],
        new Date(2026, 1, 3, 12),
        new Date(2026, 1, 5, 12),
      )
      document.dispatchEvent(new MouseEvent('mouseup'))
    })

    expect(onDirectEdit).toHaveBeenCalledTimes(1)
    await act(async () => {
      completeRequest()
      await new Promise((resolve) => window.setTimeout(resolve, 30))
    })
    act(() => ganttMock.options?.on_click?.(ganttMock.tasks[0]))
    expect(chart.props.onTaskSelect).not.toHaveBeenCalled()

    pointerGesture(task, { x: 100, y: 110 }, undefined, 2)
    fireEvent.click(task)
    act(() => ganttMock.options?.on_click?.(ganttMock.tasks[0]))

    expect(chart.props.onTaskSelect).toHaveBeenCalledTimes(1)
  })

  it('preserves gesture suppression through preview and Apply', async () => {
    const { current, proposed, changeset } = makeSergeyPendingScenario()
    const preview = buildPendingPlanPreview(current, changeset)
    if (!preview) throw new Error('Expected pending preview')
    const chart = renderChart({ plan: current })
    const task = taskPart(chart.container, 'TASK-003')

    pointerGesture(task, { x: 100, y: 110 }, { x: 112, y: 110 })

    chart.rerender(<GanttChart
      {...chart.props}
      plan={current}
      preview={preview}
      interactionDisabled
    />)
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 30))
    })
    act(() => ganttMock.options?.on_click?.(
      ganttMock.tasks.find((candidate) => candidate.id === 'TASK-003')!,
    ))
    expect(chart.props.onTaskSelect).not.toHaveBeenCalled()

    chart.rerender(<GanttChart
      {...chart.props}
      plan={proposed}
      preview={null}
      interactionDisabled={false}
    />)
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 30))
    })
    act(() => ganttMock.options?.on_click?.(
      ganttMock.tasks.find((candidate) => candidate.id === 'TASK-003')!,
    ))
    expect(chart.props.onTaskSelect).not.toHaveBeenCalled()

    const appliedTask = taskPart(chart.container, 'TASK-003')
    pointerGesture(appliedTask, { x: 100, y: 110 }, undefined, 2)
    fireEvent.click(appliedTask)
    act(() => ganttMock.options?.on_click?.(
      ganttMock.tasks.find((candidate) => candidate.id === 'TASK-003')!,
    ))
    expect(chart.props.onTaskSelect).toHaveBeenCalledTimes(1)
    expect(chart.props.onTaskSelect).toHaveBeenCalledWith(proposed.tasks[2])
  })

  it('recovers a crossed gesture after lost pointer capture', async () => {
    const chart = renderChart()
    const task = taskPart(chart.container, 'TASK-001')
    const constructorCount = ganttMock.constructorCount

    fireEvent.pointerDown(task, {
      pointerId: 7,
      button: 0,
      isPrimary: true,
      clientX: 100,
      clientY: 110,
    })
    fireEvent.pointerMove(document, {
      pointerId: 7,
      isPrimary: true,
      clientX: 112,
      clientY: 110,
    })
    fireEvent(task, new PointerEvent('lostpointercapture', {
      pointerId: 7,
      isPrimary: true,
    }))
    fireEvent.pointerUp(document, {
      pointerId: 7,
      button: 0,
      isPrimary: true,
      clientX: 112,
      clientY: 110,
    })
    fireEvent.click(task)
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 30))
    })

    expect(chart.props.onDirectEdit).not.toHaveBeenCalled()
    expect(chart.props.onTaskSelect).not.toHaveBeenCalled()
    expect(ganttMock.constructorCount).toBe(constructorCount + 1)

    pointerGesture(task, { x: 100, y: 110 }, undefined, 8)
    fireEvent.click(task)
    act(() => ganttMock.options?.on_click?.(ganttMock.tasks[0]))
    expect(chart.props.onTaskSelect).toHaveBeenCalledTimes(1)
  })

  it('treats the right resize handle as a gesture even without movement', () => {
    const { container, props } = renderChart()
    const rightHandle = taskPart(container, 'TASK-001', '.handle.right')

    pointerGesture(rightHandle, { x: 160, y: 110 })
    fireEvent.click(rightHandle)
    act(() => ganttMock.options?.on_click?.(ganttMock.tasks[0]))

    expect(props.onDirectEdit).not.toHaveBeenCalled()
    expect(props.onTaskSelect).not.toHaveBeenCalled()
  })

  it('emits one resize intent and suppresses its task click', () => {
    const { container, plan, props } = renderChart()
    const rightHandle = taskPart(container, 'TASK-001', '.handle.right')

    pointerGesture(
      rightHandle,
      { x: 160, y: 110 },
      { x: 172, y: 110 },
    )
    act(() => {
      ganttMock.options?.on_date_change?.(
        ganttMock.tasks[0],
        new Date(2026, 1, 2, 12),
        new Date(2026, 1, 6, 12),
      )
      document.dispatchEvent(new MouseEvent('mouseup'))
      ganttMock.options?.on_click?.(ganttMock.tasks[0])
    })

    expect(props.onDirectEdit).toHaveBeenCalledTimes(1)
    expect(props.onDirectEdit).toHaveBeenCalledWith({
      type: 'resize',
      task: plan.tasks[0],
      intendedDate: '2026-02-06',
    })
    expect(props.onTaskSelect).not.toHaveBeenCalled()
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

    expect(ganttMock.constructorTaskCounts).toEqual([7, 7])
    expect(ganttMock.constructorTaskCounts).not.toContain(0)
    expect(ganttMock.refreshCount).toBe(0)
    expect(chart.container.querySelectorAll('.bar-wrapper')).toHaveLength(7)
    expect(ganttMock.tasks.map((task) => task.id)).toEqual(
      current.tasks.map((task) => task.public_id),
    )
    expect(JSON.stringify(ganttMock.tasks)).not.toContain('preview-current-')
    expect(chart.container.querySelectorAll('.gantt-preview-item')).toHaveLength(4)
    const task3Overlay = chart.container.querySelector(
      '.gantt-preview-item[data-task-id="TASK-003"]',
    )
    expect(task3Overlay).toHaveAttribute(
      'data-current-y',
      task3Overlay?.getAttribute('data-proposed-y'),
    )
    expect(task3Overlay).toHaveAttribute('data-source', 'direct')
    expect(chart.container.querySelector(
      '.gantt-preview-item[data-task-id="TASK-006"]',
    )).toHaveAttribute('data-source', 'dependency')
    expect(task3Overlay?.querySelector(
      '.gantt-preview-proposed-bar',
    )).toHaveClass('gantt-preview-proposed-direct')
    expect(chart.container.querySelector(
      '.gantt-preview-item[data-task-id="TASK-006"] ' +
      '.gantt-preview-proposed-bar',
    )).toHaveClass('gantt-preview-proposed-dependency')
    expect(chart.container.querySelectorAll('.bar-label')).toHaveLength(7)
    expect(chart.container.querySelectorAll(
      '.bar-label.gantt-preview-frappe-label-hidden',
    )).toHaveLength(4)
    expect(chart.container.querySelector(
      '.bar-wrapper[data-id="TASK-001"] .bar-label',
    )).not.toHaveClass('gantt-preview-frappe-label-hidden')
    expect(chart.container.querySelectorAll(
      '.gantt-preview-safe-label',
    )).toHaveLength(4)
    const wideLabel = chart.container.querySelector<SVGTextElement>(
      '.gantt-preview-item[data-task-id="TASK-003"] ' +
      '.gantt-preview-safe-label',
    )
    expect(wideLabel).toHaveAttribute('data-label-mode', 'full')
    expect(wideLabel).toHaveTextContent('3 · Основа бэкенда')
    const shortLabel = chart.container.querySelector<SVGTextElement>(
      '.gantt-preview-item[data-task-id="TASK-007"] ' +
      '.gantt-preview-safe-label',
    )
    expect(shortLabel).toHaveAttribute('data-label-mode', 'number')
    expect(shortLabel).toHaveTextContent('7')
    expect(chart.container.querySelectorAll(
      '.gantt-preview-overlay text:not(.gantt-preview-safe-label)',
    )).toHaveLength(0)
    const task3Bar = chart.container.querySelector<SVGRectElement>(
      '.bar-wrapper[data-id="TASK-003"] .bar',
    )
    const task3Clip = task3Overlay?.querySelector<SVGRectElement>(
      '.gantt-preview-current-label-clip rect',
    )
    expect(task3Clip).toHaveAttribute('x', task3Bar?.getAttribute('x'))
    expect(task3Clip).toHaveAttribute('y', task3Bar?.getAttribute('y'))
    expect(task3Clip).toHaveAttribute('width', task3Bar?.getAttribute('width'))
    expect(task3Clip).toHaveAttribute('height', task3Bar?.getAttribute('height'))
    expect(Number(wideLabel?.getAttribute('x'))).toBeGreaterThanOrEqual(
      Number(task3Bar?.getAttribute('x')),
    )
    expect(task3Overlay?.lastElementChild).toBe(wideLabel)
    const task3Group = chart.container.querySelector(
      '.bar-wrapper[data-id="TASK-003"]',
    )
    expect(task3Group).toHaveAttribute(
      'aria-label',
      'TASK-003 · Основа бэкенда',
    )
    expect(task3Group?.querySelector('.gantt-preview-task-title')).toHaveTextContent(
      'TASK-003 · Основа бэкенда',
    )
    expect(chart.container.querySelectorAll(
      '.gantt-preview-current-label',
    )).toHaveLength(0)
    expect(chart.container.querySelectorAll('.gantt-preview-label')).toHaveLength(0)
    expect(chart.container.querySelectorAll('.gantt-preview-delta')).toHaveLength(0)
    expect(chart.container.querySelectorAll('.gantt-preview-reason')).toHaveLength(0)
    expect(chart.container.querySelector('svg.gantt')).toHaveAttribute(
      'height',
      '459',
    )
    expect(chart.container.querySelector('animate')).not.toBeInTheDocument()
  })

  it('keeps the current label above a partially overlapping outline', async () => {
    const { current, changeset } = makeSergeyPendingScenario()
    const preview = buildPendingPlanPreview(current, changeset)
    if (!preview) throw new Error('Expected pending preview')
    const overlapPreview = structuredClone(preview)
    const overlapChange = overlapPreview.changes.find(
      (change) => change.publicId === 'TASK-003',
    )
    if (!overlapChange?.proposedTask) {
      throw new Error('Expected TASK-003 proposed dates')
    }
    overlapChange.proposedTask = {
      ...overlapChange.proposedTask,
      start_date: '2026-02-09',
      end_date: '2026-02-13',
    }

    const chart = renderChart({
      plan: current,
      preview: overlapPreview,
      interactionDisabled: true,
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 30))
    })

    const item = chart.container.querySelector(
      '.gantt-preview-item[data-task-id="TASK-003"]',
    )
    const proposedBar = item?.querySelector('.gantt-preview-proposed-bar')
    const safeLabel = item?.querySelector('.gantt-preview-safe-label')
    expect(item).toHaveAttribute('data-overlap', 'true')
    expect(safeLabel).toHaveAttribute('data-label-mode', 'full')
    expect(safeLabel).toHaveTextContent('3 · Основа бэкенда')
    expect(Array.from(item?.children ?? []).indexOf(proposedBar!)).toBeLessThan(
      Array.from(item?.children ?? []).indexOf(safeLabel!),
    )
  })

  it('removes preview overlays on Apply and reconciles proposed dates', async () => {
    const { current, proposed, changeset } = makeSergeyPendingScenario()
    const preview = buildPendingPlanPreview(current, changeset)
    const chart = renderChart({
      plan: current,
      preview,
      interactionDisabled: true,
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 30))
    })
    expect(chart.container.querySelector('.gantt-preview-overlay')).not.toBeNull()

    chart.rerender(<GanttChart
      {...chart.props}
      plan={proposed}
      preview={null}
      interactionDisabled={false}
    />)

    expect(chart.container.querySelector('.gantt-preview-overlay')).toBeNull()
    expect(chart.container.querySelectorAll(
      '.gantt-preview-frappe-label-hidden',
    )).toHaveLength(0)
    expect(chart.container.querySelectorAll(
      '.gantt-preview-task-title',
    )).toHaveLength(0)
    expect(chart.container.querySelector(
      '.bar-wrapper[data-id="TASK-003"]',
    )).not.toHaveAttribute('aria-label')
    expect(chart.container.querySelector(
      '.bar-wrapper[data-id="TASK-003"] .bar',
    )).toHaveAttribute('data-start', '2026-02-12')
    expect(chart.container.querySelectorAll('.bar-wrapper')).toHaveLength(7)
  })

  it('removes preview overlays on Cancel without mutating current dates', async () => {
    const { current, changeset } = makeSergeyPendingScenario()
    const snapshot = structuredClone(current)
    const preview = buildPendingPlanPreview(current, changeset)
    const chart = renderChart({
      plan: current,
      preview,
      interactionDisabled: true,
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 30))
    })
    const scroller = chart.container.querySelector<HTMLElement>('.gantt-container')
    if (scroller) scroller.scrollLeft = 77

    chart.rerender(<GanttChart
      {...chart.props}
      plan={current}
      preview={null}
      interactionDisabled={false}
    />)

    expect(current).toEqual(snapshot)
    expect(chart.container.querySelector('.gantt-preview-overlay')).toBeNull()
    expect(chart.container.querySelectorAll(
      '.gantt-preview-frappe-label-hidden',
    )).toHaveLength(0)
    expect(chart.container.querySelectorAll(
      '.gantt-preview-task-title',
    )).toHaveLength(0)
    expect(chart.container.querySelector(
      '.bar-wrapper[data-id="TASK-003"]',
    )).not.toHaveAttribute('aria-label')
    expect(chart.container.querySelector(
      '.bar-wrapper[data-id="TASK-003"] .bar',
    )).toHaveAttribute('data-start', '2026-02-05')
    expect(chart.container.querySelectorAll('.bar-wrapper')).toHaveLength(7)
    expect(chart.container.querySelector<HTMLElement>(
      '.gantt-container',
    )?.scrollLeft).toBe(77)
  })

  it('disables drag and resize whenever a pending ChangeSet exists', () => {
    const { current, changeset } = makeSergeyPendingScenario()
    const preview = buildPendingPlanPreview(current, changeset)
    const onTaskSelect = vi.fn()
    const onDirectEdit = vi.fn()
    const chart = renderChart({
      plan: current,
      preview,
      interactionDisabled: true,
      onTaskSelect,
      onDirectEdit,
    })
    const task = taskPart(chart.container, 'TASK-001')
    pointerGesture(task, { x: 100, y: 110 }, { x: 112, y: 110 })
    fireEvent.click(task)
    act(() => ganttMock.options?.on_click?.(ganttMock.tasks[0]))

    expect(ganttMock.options?.readonly).toBe(true)
    expect(ganttMock.options?.readonly_dates).toBe(true)
    expect(onDirectEdit).not.toHaveBeenCalled()
    expect(onTaskSelect).not.toHaveBeenCalled()
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
