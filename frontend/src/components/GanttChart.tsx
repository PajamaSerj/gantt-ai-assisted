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

type GanttGestureTarget = 'task-body' | 'right-resize'

type GanttGestureSession = {
  pointerId: number
  taskPublicId: string
  originX: number
  originY: number
  currentX: number
  currentY: number
  maximumMovement: number
  target: GanttGestureTarget
  crossedThreshold: boolean
  captureTarget: SVGGElement
}

type GanttGestureHit = {
  taskPublicId: string
  target: GanttGestureTarget
  wrapper: SVGGElement
}

const GANTT_GESTURE_THRESHOLD = 3

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
  previewLocked: boolean,
  recoveryEpoch: number,
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
    previewLocked,
    recoveryEpoch,
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

function ganttGestureHit(
  container: HTMLElement,
  eventTarget: EventTarget | null,
): GanttGestureHit | null {
  if (!(eventTarget instanceof Element)) return null
  const wrapper = eventTarget.closest<SVGGElement>(
    '.bar-wrapper[data-id]',
  )
  if (!wrapper || !container.contains(wrapper)) return null
  const taskPublicId = wrapper.dataset.id
  if (!taskPublicId || eventTarget.closest('.handle.left')) return null
  return {
    taskPublicId,
    target: eventTarget.closest('.handle.right')
      ? 'right-resize'
      : 'task-body',
    wrapper,
  }
}

function releaseGestureCapture(session: GanttGestureSession): void {
  try {
    if (
      typeof session.captureTarget.hasPointerCapture !== 'function' ||
      typeof session.captureTarget.releasePointerCapture !== 'function' ||
      !session.captureTarget.hasPointerCapture(session.pointerId)
    ) return
    session.captureTarget.releasePointerCapture(session.pointerId)
  } catch {
    // A detached/reconstructed SVG node may already have lost capture.
  }
}

function updateGestureMovement(
  session: GanttGestureSession,
  event: PointerEvent,
): void {
  session.currentX = event.clientX
  session.currentY = event.clientY
  const movement = Math.hypot(
    session.currentX - session.originX,
    session.currentY - session.originY,
  )
  session.maximumMovement = Math.max(session.maximumMovement, movement)
  if (session.maximumMovement >= GANTT_GESTURE_THRESHOLD) {
    session.crossedThreshold = true
  }
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
  const latestRenderedPlanRef = useRef(plan)
  const latestTimelinePlanRef = useRef(plan)
  const latestDataSignatureRef = useRef('')
  const latestAffectedPublicIdsRef = useRef(affectedPublicIds)
  const latestViewportWidthRef = useRef(0)
  const viewModeRef = useRef(viewMode)
  const scrollLeftRef = useRef<number | null>(null)
  const scrollTokenRef = useRef<number | null>(null)
  const pendingDatesRef = useRef<ProvisionalGanttDates | null>(null)
  const gestureSessionRef = useRef<GanttGestureSession | null>(null)
  const suppressNextClickTaskIdRef = useRef<string | null>(null)
  const gestureRecoveryFrameRef = useRef<number | null>(null)
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
  const [recoveryEpoch, setRecoveryEpoch] = useState(0)

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
    Boolean(preview),
    recoveryEpoch,
  )
  latestRenderedPlanRef.current = plan
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
      if (gestureSessionRef.current) {
        releaseGestureCapture(gestureSessionRef.current)
      }
      gestureSessionRef.current = null
      suppressNextClickTaskIdRef.current = null
      if (gestureRecoveryFrameRef.current !== null) {
        window.cancelAnimationFrame(gestureRecoveryFrameRef.current)
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
    const interactionLocked = () => (
      interactionDisabledRef.current || interactionBusyRef.current ||
      directEditPendingRef.current || Boolean(previewRef.current)
    )
    const consumeTaskClick = (taskPublicId: string): boolean => {
      if (interactionLocked()) return true
      if (suppressNextClickTaskIdRef.current === taskPublicId) {
        suppressNextClickTaskIdRef.current = null
        return true
      }
      return false
    }
    chartRef.current = new Gantt(container, renderedTasks, {
      ...GANTT_SAFETY_OPTIONS,
      ...ganttInteractionOptions(Boolean(previewRef.current)),
      view_mode: viewModeRef.current,
      view_modes: ganttViewModes(
        latestTimelinePlanRef.current,
        latestViewportWidthRef.current,
        latestRenderedPlanRef.current,
      ),
      scroll_to: taskBounds?.start || 'start',
      today_button: false,
      popup: false,
      container_height: 'auto',
      bar_height: 32,
      padding: 20,
      on_click: (selected) => {
        if (consumeTaskClick(selected.id)) return
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
        suppressNextClickTaskIdRef.current = selected.id
      },
    })

    chartRef.current.change_view_mode(viewModeRef.current, false)
    settleGanttRendering(container)
    schedulePreviewOverlay(container)
    renderedTasksRef.current = taskSnapshotMap(renderedTasks)
    renderedDataSignatureRef.current = latestDataSignatureRef.current

    const startGesture = (event: PointerEvent) => {
      if (
        event.button !== 0 || event.isPrimary === false || interactionLocked()
      ) return
      const hit = ganttGestureHit(container, event.target)
      if (!hit) return
      if (gestureSessionRef.current) {
        releaseGestureCapture(gestureSessionRef.current)
      }
      suppressNextClickTaskIdRef.current = null
      if (typeof hit.wrapper.setPointerCapture === 'function') {
        try {
          hit.wrapper.setPointerCapture(event.pointerId)
        } catch {
          // Document-level listeners below still complete the gesture safely.
        }
      }
      gestureSessionRef.current = {
        pointerId: event.pointerId,
        taskPublicId: hit.taskPublicId,
        originX: event.clientX,
        originY: event.clientY,
        currentX: event.clientX,
        currentY: event.clientY,
        maximumMovement: 0,
        target: hit.target,
        crossedThreshold: false,
        captureTarget: hit.wrapper,
      }
    }
    const moveGesture = (event: PointerEvent) => {
      const session = gestureSessionRef.current
      if (!session || session.pointerId !== event.pointerId) return
      updateGestureMovement(session, event)
    }
    const scheduleGestureRecovery = () => {
      if (gestureRecoveryFrameRef.current !== null) {
        window.cancelAnimationFrame(gestureRecoveryFrameRef.current)
      }
      gestureRecoveryFrameRef.current = window.requestAnimationFrame(() => {
        gestureRecoveryFrameRef.current = null
        if (!mountedRef.current) return
        pendingDatesRef.current = null
        setRecoveryEpoch((current) => current + 1)
      })
    }
    const completeGesture = (
      session: GanttGestureSession,
      suppressClick: boolean,
      releaseCapture: boolean,
      recoverGeometry: boolean,
    ) => {
      if (suppressClick) {
        suppressNextClickTaskIdRef.current = session.taskPublicId
      }
      gestureSessionRef.current = null
      if (releaseCapture) releaseGestureCapture(session)
      if (recoverGeometry) scheduleGestureRecovery()
    }
    const finishGesture = (event: PointerEvent) => {
      const session = gestureSessionRef.current
      if (!session || session.pointerId !== event.pointerId) return
      updateGestureMovement(session, event)
      completeGesture(
        session,
        session.target === 'right-resize' || session.crossedThreshold,
        true,
        !(event.target instanceof Node && container.contains(event.target)),
      )
    }
    const cancelGesture = (event: PointerEvent) => {
      const session = gestureSessionRef.current
      if (!session || session.pointerId !== event.pointerId) return
      completeGesture(
        session,
        session.target === 'right-resize' || session.crossedThreshold,
        true,
        true,
      )
    }
    const loseGestureCapture = (event: PointerEvent) => {
      const session = gestureSessionRef.current
      if (!session || session.pointerId !== event.pointerId) return
      completeGesture(
        session,
        session.target === 'right-resize' || session.crossedThreshold,
        false,
        true,
      )
    }
    const suppressGestureClick = (event: MouseEvent) => {
      const hit = ganttGestureHit(container, event.target)
      if (!hit) return
      if (event.isTrusted && !consumeTaskClick(hit.taskPublicId)) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }
    container.addEventListener('pointerdown', startGesture, true)
    container.addEventListener('pointermove', moveGesture, true)
    container.addEventListener('pointerup', finishGesture, true)
    container.addEventListener('pointercancel', cancelGesture, true)
    container.addEventListener('lostpointercapture', loseGestureCapture, true)
    container.addEventListener('click', suppressGestureClick, true)
    document.addEventListener('pointermove', moveGesture, true)
    document.addEventListener('pointerup', finishGesture, true)
    document.addEventListener('pointercancel', cancelGesture, true)

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
      } else {
        const currentChart = chartRef.current
        const currentContainer = containerRef.current
        const authoritativeTask = latestTasksRef.current.find(
          (candidate) => candidate.id === task.public_id,
        )
        if (currentChart && currentContainer && authoritativeTask) {
          reconcileGanttTasks(
            currentChart,
            currentContainer,
            [authoritativeTask],
          )
          schedulePreviewOverlay(currentContainer)
        }
      }
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
      container.removeEventListener('pointerdown', startGesture, true)
      container.removeEventListener('pointermove', moveGesture, true)
      container.removeEventListener('pointerup', finishGesture, true)
      container.removeEventListener('pointercancel', cancelGesture, true)
      container.removeEventListener(
        'lostpointercapture',
        loseGestureCapture,
        true,
      )
      container.removeEventListener('click', suppressGestureClick, true)
      document.removeEventListener('pointermove', moveGesture, true)
      document.removeEventListener('pointerup', finishGesture, true)
      document.removeEventListener('pointercancel', cancelGesture, true)
      scroller?.removeEventListener('scroll', handleHorizontalScroll)
      pendingDatesRef.current = null
      if (gestureSessionRef.current) {
        releaseGestureCapture(gestureSessionRef.current)
      }
      gestureSessionRef.current = null
      if (scroller) scrollLeftRef.current = scroller.scrollLeft
      chartRef.current = null
      renderedTasksRef.current = new Map()
      renderedDataSignatureRef.current = null
      if (previewOverlayFrameRef.current !== null) {
        window.cancelAnimationFrame(previewOverlayFrameRef.current)
        previewOverlayFrameRef.current = null
      }
      if (gestureRecoveryFrameRef.current !== null) {
        window.cancelAnimationFrame(gestureRecoveryFrameRef.current)
        gestureRecoveryFrameRef.current = null
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
    if (gestureSessionRef.current) {
      releaseGestureCapture(gestureSessionRef.current)
    }
    gestureSessionRef.current = null
  }, [previewSignature])

  useLayoutEffect(() => {
    suppressNextClickTaskIdRef.current = null
  }, [scrollToStartToken])

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
