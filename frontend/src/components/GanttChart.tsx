import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Gantt, { type GanttTask } from 'frappe-gantt'

import {
  GANTT_SAFETY_OPTIONS,
  ganttInteractionOptions,
} from '../gantt-config'
import {
  directEditIntent,
  disableLeftResizeHandles,
  type ProvisionalGanttDates,
} from '../gantt-interaction'
import {
  removeGanttPreviewOverlay,
  renderGanttPreviewOverlay,
} from '../gantt-preview-overlay'
import { ganttTasks } from '../gantt-tasks'
import {
  ganttTaskBounds,
  ganttTimelinePlan,
  ganttViewModes,
  projectTimelineBounds,
  timelineSizing,
  type GanttViewName,
} from '../gantt-timeline'
import type { PendingPlanPreview } from '../pending-preview'
import type { DirectEditIntent, PlanState, Task } from '../types'

type ViewMode = 'Day' | 'Week' | 'Month'

type GanttChartProps = {
  plan: PlanState
  preview: PendingPlanPreview | null
  affectedPublicIds: Set<string>
  viewMode: ViewMode
  scrollToStartToken: number
  interactionDisabled: boolean
  interactionBusy: boolean
  onTaskSelect: (task: Task) => void
  onDirectEdit: (intent: DirectEditIntent) => void | Promise<void>
}

type GanttTaskSnapshot = Pick<
  GanttTask,
  'id' | 'name' | 'start' | 'end' | 'dependencies' | 'custom_class'
>

type DirectEditSession = {
  taskPublicId: string
}

type GanttWithArrows = Gantt & {
  arrows?: Array<{ update: () => void }>
}

function taskSnapshot(task: GanttTask): GanttTaskSnapshot {
  const runtimeDependencies = task.dependencies as string | string[] | undefined
  return {
    id: task.id,
    name: task.name,
    start: task.start,
    end: task.end,
    dependencies: Array.isArray(runtimeDependencies)
      ? runtimeDependencies.join(', ')
      : runtimeDependencies ?? '',
    custom_class: task.custom_class,
  }
}

function taskSnapshotMap(tasks: GanttTask[]): Map<string, GanttTaskSnapshot> {
  return new Map(tasks.map((task) => [task.id, taskSnapshot(task)]))
}

function taskDataSignature(tasks: GanttTask[]): string {
  return JSON.stringify(tasks.map(taskSnapshot))
}

function previewDataSignature(preview: PendingPlanPreview | null): string {
  if (!preview) return 'none'
  return JSON.stringify(preview.changes.map((change) => ({
    id: change.internalId,
    kind: change.kind,
    source: change.source,
    currentStart: change.currentTask?.start_date,
    currentEnd: change.currentTask?.end_date,
    currentDuration: change.currentTask?.duration_workdays,
    proposedStart: change.proposedTask?.start_date,
    proposedEnd: change.proposedTask?.end_date,
    proposedDuration: change.proposedTask?.duration_workdays,
  })))
}

function chartLayoutSignature(
  tasks: GanttTask[],
  timelinePlan: PlanState,
  viewportWidth: number,
  viewMode: GanttViewName,
): string {
  return JSON.stringify({
    rows: tasks.map((task) => ({
      id: task.id,
      dependencies: task.dependencies ?? '',
      customClass: task.custom_class ?? '',
    })),
    timeline: {
      viewMode,
      bounds: projectTimelineBounds(timelinePlan, viewMode),
      sizing: timelineSizing(timelinePlan, viewMode, viewportWidth),
    },
  })
}

function frappeDate(value: string, exclusiveEnd = false): Date {
  const [year, month, day] = value.split('-').map(Number)
  const result = new Date(year, month - 1, day)
  if (exclusiveEnd) result.setDate(result.getDate() + 1)
  return result
}

function settleGanttRendering(container: HTMLElement): void {
  container.querySelectorAll('animate').forEach((animation) => animation.remove())
  disableLeftResizeHandles(container)
}

function reconcileGanttTasks(
  chart: Gantt,
  container: HTMLElement,
  tasks: GanttTask[],
): void {
  tasks.forEach((task) => {
    chart.update_task(task.id, {
      name: task.name,
      start: task.start,
      end: task.end,
      _start: frappeDate(task.start),
      _end: frappeDate(task.end, true),
    })
  })
  const runtimeChart = chart as GanttWithArrows
  runtimeChart.arrows?.forEach((arrow) => arrow.update())
  settleGanttRendering(container)
}

function highlightAffectedArrows(
  container: HTMLElement,
  affectedPublicIds: Set<string>,
) {
  container
    .querySelectorAll<SVGPathElement>('path[data-from][data-to]')
    .forEach((arrow) => {
      const from = arrow.dataset.from
      const to = arrow.dataset.to
      arrow.classList.toggle(
        'gantt-arrow-affected',
        Boolean(
          (from && affectedPublicIds.has(from)) ||
          (to && affectedPublicIds.has(to)),
        ),
      )
    })
}

export function GanttChart({
  plan,
  preview,
  affectedPublicIds,
  viewMode,
  scrollToStartToken,
  interactionDisabled,
  interactionBusy,
  onTaskSelect,
  onDirectEdit,
}: GanttChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<Gantt | null>(null)
  const taskByGanttIdRef = useRef(new Map<string, Task>())
  const renderedTasksRef = useRef(new Map<string, GanttTaskSnapshot>())
  const renderedDataSignatureRef = useRef<string | null>(null)
  const latestTasksRef = useRef<GanttTask[]>([])
  const latestTimelinePlanRef = useRef(plan)
  const latestDataSignatureRef = useRef('')
  const latestAffectedPublicIdsRef = useRef(affectedPublicIds)
  const latestViewportWidthRef = useRef(0)
  const viewModeRef = useRef(viewMode)
  const scrollLeftRef = useRef<number | null>(null)
  const scrollTokenRef = useRef<number | null>(null)
  const pendingDatesRef = useRef<ProvisionalGanttDates | null>(null)
  const suppressClickRef = useRef(false)
  const clickResetTimerRef = useRef<number | null>(null)
  const previewOverlayFrameRef = useRef<number | null>(null)
  const directEditCompletionFrameRef = useRef<number | null>(null)
  const directEditSessionRef = useRef<DirectEditSession | null>(null)
  const directEditPendingRef = useRef(false)
  const mountedRef = useRef(true)
  const interactionDisabledRef = useRef(interactionDisabled)
  const interactionBusyRef = useRef(interactionBusy)
  const previewRef = useRef(preview)
  const onTaskSelectRef = useRef(onTaskSelect)
  const onDirectEditRef = useRef(onDirectEdit)
  const [viewportWidth, setViewportWidth] = useState(0)

  interactionDisabledRef.current = interactionDisabled
  interactionBusyRef.current = interactionBusy
  previewRef.current = preview
  viewModeRef.current = viewMode
  onTaskSelectRef.current = onTaskSelect
  onDirectEditRef.current = onDirectEdit

  const tasks = ganttTasks(
    plan,
    preview ? new Set<string>() : affectedPublicIds,
  )
  latestTasksRef.current = tasks
  const timelinePlan = ganttTimelinePlan(
    plan,
    preview?.proposedPlan ?? null,
  )
  const dataSignature = taskDataSignature(tasks)
  const previewSignature = previewDataSignature(preview)
  const layoutSignature = chartLayoutSignature(
    tasks,
    timelinePlan,
    viewportWidth,
    viewMode,
  )
  latestTimelinePlanRef.current = timelinePlan
  latestDataSignatureRef.current = dataSignature
  latestAffectedPublicIdsRef.current = affectedPublicIds
  latestViewportWidthRef.current = viewportWidth
  const byGanttId = new Map<string, Task>()
  plan.tasks.forEach((task) => {
    byGanttId.set(task.public_id, task)
  })
  taskByGanttIdRef.current = byGanttId

  const schedulePreviewOverlay = (container: HTMLElement) => {
    if (previewOverlayFrameRef.current !== null) {
      window.cancelAnimationFrame(previewOverlayFrameRef.current)
    }
    if (!previewRef.current) {
      removeGanttPreviewOverlay(container)
      previewOverlayFrameRef.current = null
      return
    }
    previewOverlayFrameRef.current = window.requestAnimationFrame(() => {
      renderGanttPreviewOverlay(
        container,
        previewRef.current,
        chartRef.current ?? {},
      )
      previewOverlayFrameRef.current = null
    })
  }

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const updateWidth = (reportedWidth?: number) => {
      const measuredWidth = reportedWidth ?? container.getBoundingClientRect().width
      const nextWidth = Math.max(0, Math.floor(measuredWidth))
      setViewportWidth((currentWidth) =>
        currentWidth === nextWidth ? currentWidth : nextWidth,
      )
    }
    updateWidth()
    if (typeof ResizeObserver === 'undefined') {
      const handleWindowResize = () => updateWidth()
      window.addEventListener('resize', handleWindowResize)
      return () => window.removeEventListener('resize', handleWindowResize)
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries.find((candidate) => candidate.target === container)
      updateWidth(entry?.contentRect.width)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (clickResetTimerRef.current !== null) {
        window.clearTimeout(clickResetTimerRef.current)
      }
      if (previewOverlayFrameRef.current !== null) {
        window.cancelAnimationFrame(previewOverlayFrameRef.current)
      }
      if (directEditCompletionFrameRef.current !== null) {
        window.cancelAnimationFrame(directEditCompletionFrameRef.current)
      }
    }
  }, [])

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const renderedTasks = latestTasksRef.current
    if (renderedTasks.length === 0) return
    const taskBounds = ganttTaskBounds(renderedTasks)
    const forcePlanStart = scrollTokenRef.current !== scrollToStartToken
    chartRef.current = new Gantt(container, renderedTasks, {
      ...GANTT_SAFETY_OPTIONS,
      ...ganttInteractionOptions(Boolean(previewRef.current)),
      view_mode: viewModeRef.current,
      view_modes: ganttViewModes(
        latestTimelinePlanRef.current,
        latestViewportWidthRef.current,
      ),
      scroll_to: taskBounds?.start || 'start',
      today_button: false,
      popup: false,
      container_height: 'auto',
      bar_height: 32,
      padding: 20,
      on_click: (selected) => {
        if (suppressClickRef.current) return
        const task = taskByGanttIdRef.current.get(selected.id)
        if (task) onTaskSelectRef.current(task)
      },
      on_date_change: (selected, start, end) => {
        if (
          interactionDisabledRef.current || interactionBusyRef.current ||
          directEditPendingRef.current || previewRef.current
        ) return
        if (!taskByGanttIdRef.current.has(selected.id)) return
        pendingDatesRef.current = {
          taskPublicId: selected.id,
          start,
          end,
        }
        suppressClickRef.current = true
      },
    })

    chartRef.current.change_view_mode(viewModeRef.current, false)
    settleGanttRendering(container)
    schedulePreviewOverlay(container)
    renderedTasksRef.current = taskSnapshotMap(renderedTasks)
    renderedDataSignatureRef.current = latestDataSignatureRef.current

    const finishInteraction = () => {
      const provisional = pendingDatesRef.current
      if (!provisional) return
      pendingDatesRef.current = null
      const task = taskByGanttIdRef.current.get(provisional.taskPublicId)
      if (!task) return
      const intent = directEditIntent(task, provisional)
      if (intent) {
        directEditSessionRef.current = { taskPublicId: task.public_id }
        directEditPendingRef.current = true
        container.classList.add('gantt-direct-edit-busy')
        const completion = onDirectEditRef.current(intent)
        void Promise.resolve(completion).finally(() => {
          if (!mountedRef.current) return
          if (directEditCompletionFrameRef.current !== null) {
            window.cancelAnimationFrame(directEditCompletionFrameRef.current)
          }
          directEditCompletionFrameRef.current = window.requestAnimationFrame(
            () => {
              const session = directEditSessionRef.current
              const currentChart = chartRef.current
              const currentContainer = containerRef.current
              if (
                session && currentChart && currentContainer &&
                !previewRef.current
              ) {
                const authoritativeTask = latestTasksRef.current.find(
                  (candidate) => candidate.id === session.taskPublicId,
                )
                if (authoritativeTask) {
                  reconcileGanttTasks(
                    currentChart,
                    currentContainer,
                    [authoritativeTask],
                  )
                  schedulePreviewOverlay(currentContainer)
                }
              }
              directEditSessionRef.current = null
              directEditPendingRef.current = false
              currentContainer?.classList.remove('gantt-direct-edit-busy')
              directEditCompletionFrameRef.current = null
            },
          )
        })
      }
      if (clickResetTimerRef.current !== null) {
        window.clearTimeout(clickResetTimerRef.current)
      }
      clickResetTimerRef.current = window.setTimeout(() => {
        suppressClickRef.current = false
        clickResetTimerRef.current = null
      }, 250)
    }
    document.addEventListener('mouseup', finishInteraction)
    document.addEventListener('touchend', finishInteraction)

    const scroller = container.querySelector<HTMLElement>('.gantt-container')
    const handleHorizontalScroll = () => schedulePreviewOverlay(container)
    scroller?.addEventListener('scroll', handleHorizontalScroll, {
      passive: true,
    })
    if (!forcePlanStart && scroller && scrollLeftRef.current !== null) {
      scroller.scrollLeft = scrollLeftRef.current
    }
    scrollTokenRef.current = scrollToStartToken
    highlightAffectedArrows(container, latestAffectedPublicIdsRef.current)

    return () => {
      document.removeEventListener('mouseup', finishInteraction)
      document.removeEventListener('touchend', finishInteraction)
      scroller?.removeEventListener('scroll', handleHorizontalScroll)
      pendingDatesRef.current = null
      if (scroller) scrollLeftRef.current = scroller.scrollLeft
      chartRef.current = null
      renderedTasksRef.current = new Map()
      renderedDataSignatureRef.current = null
      if (previewOverlayFrameRef.current !== null) {
        window.cancelAnimationFrame(previewOverlayFrameRef.current)
        previewOverlayFrameRef.current = null
      }
      container.replaceChildren()
    }
  }, [layoutSignature, scrollToStartToken])

  useLayoutEffect(() => {
    const chart = chartRef.current
    const container = containerRef.current
    if (
      !chart || !container ||
      renderedDataSignatureRef.current === dataSignature
    ) return
    const previousTasks = renderedTasksRef.current
    const currentTasks = latestTasksRef.current
    const changedTasks = currentTasks.filter((task) => (
      JSON.stringify(previousTasks.get(task.id)) !==
      JSON.stringify(taskSnapshot(task))
    ))
    reconcileGanttTasks(chart, container, changedTasks)
    schedulePreviewOverlay(container)
    renderedTasksRef.current = taskSnapshotMap(currentTasks)
    renderedDataSignatureRef.current = dataSignature
  }, [dataSignature, layoutSignature])

  useLayoutEffect(() => {
    const chart = chartRef.current
    const container = containerRef.current
    if (!container) return
    highlightAffectedArrows(container, latestAffectedPublicIdsRef.current)
    if (!preview) {
      if (previewOverlayFrameRef.current !== null) {
        window.cancelAnimationFrame(previewOverlayFrameRef.current)
        previewOverlayFrameRef.current = null
      }
      removeGanttPreviewOverlay(container)
      return
    }
    if (!chart) return

    const changedIds = new Set(
      preview.changes
        .filter((change) => change.kind === 'dates' && change.currentTask)
        .map((change) => change.publicId),
    )
    const authoritativeTasks = latestTasksRef.current.filter(
      (task) => changedIds.has(task.id),
    )
    reconcileGanttTasks(chart, container, authoritativeTasks)
    schedulePreviewOverlay(container)
  }, [layoutSignature, preview, previewSignature])

  if (plan.tasks.length === 0 && !preview?.proposedPlan.tasks.length) {
    return (
      <div className="empty-state">
        <strong>В плане пока нет задач</strong>
        <span>Импортируйте Excel или добавьте задачу через AI-помощника.</span>
      </div>
    )
  }

  return (
    <div
      className={[
        'gantt-host',
        interactionDisabled || interactionBusy
          ? 'gantt-interaction-disabled'
          : 'gantt-interactive',
        interactionBusy ? 'gantt-direct-edit-busy' : '',
        interactionDisabled && !preview ? 'gantt-transient-disabled' : '',
      ].filter(Boolean).join(' ')}
      ref={containerRef}
      data-testid="gantt-chart"
      data-viewport-width={viewportWidth}
    />
  )
}
