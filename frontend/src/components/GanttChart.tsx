import { useEffect, useRef } from 'react'
import Gantt from 'frappe-gantt'

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
  currentPreviewTaskId,
  ganttPreviewTasks,
  ganttTasks,
} from '../gantt-tasks'
import {
  ganttTaskBounds,
  ganttTimelinePlan,
  ganttViewModes,
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
  onDirectEdit: (intent: DirectEditIntent) => void
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
      if (
        (from && affectedPublicIds.has(from)) ||
        (to && affectedPublicIds.has(to))
      ) {
        arrow.classList.add('gantt-arrow-affected')
      }
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
  const viewModeRef = useRef(viewMode)
  const scrollLeftRef = useRef<number | null>(null)
  const scrollTokenRef = useRef<number | null>(null)
  const pendingDatesRef = useRef<ProvisionalGanttDates | null>(null)
  const suppressClickRef = useRef(false)
  const clickResetTimerRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (clickResetTimerRef.current !== null) {
      window.clearTimeout(clickResetTimerRef.current)
    }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const tasks = preview
      ? ganttPreviewTasks(preview)
      : ganttTasks(plan, affectedPublicIds)
    if (tasks.length === 0) return
    const timelinePlan = ganttTimelinePlan(
      plan,
      preview?.proposedPlan ?? null,
    )
    const taskBounds = ganttTaskBounds(tasks)
    const byGanttId = new Map<string, Task>()
    plan.tasks.forEach((task) => {
      byGanttId.set(task.public_id, task)
      byGanttId.set(currentPreviewTaskId(task.public_id), task)
    })
    const forcePlanStart = scrollTokenRef.current !== scrollToStartToken
    chartRef.current = new Gantt(container, tasks, {
      ...GANTT_SAFETY_OPTIONS,
      ...ganttInteractionOptions(
        interactionDisabled || interactionBusy || Boolean(preview),
      ),
      view_mode: viewModeRef.current,
      view_modes: ganttViewModes(timelinePlan),
      scroll_to: taskBounds?.start || 'start',
      today_button: false,
      popup: false,
      container_height: 'auto',
      bar_height: 32,
      padding: 20,
      on_click: (selected) => {
        if (suppressClickRef.current) return
        const task = byGanttId.get(selected.id)
        if (task) onTaskSelect(task)
      },
      on_date_change: (selected, start, end) => {
        if (interactionDisabled || interactionBusy || preview) return
        if (!byGanttId.has(selected.id)) return
        pendingDatesRef.current = {
          taskPublicId: selected.id,
          start,
          end,
        }
        suppressClickRef.current = true
      },
    })

    chartRef.current.change_view_mode(viewModeRef.current, false)
    disableLeftResizeHandles(container)

    const finishInteraction = () => {
      const provisional = pendingDatesRef.current
      if (!provisional) return
      pendingDatesRef.current = null
      const task = byGanttId.get(provisional.taskPublicId)
      if (!task) return
      const intent = directEditIntent(task, provisional)
      const authoritativeTasks = preview
        ? ganttPreviewTasks(preview)
        : ganttTasks(plan, affectedPublicIds)
      const previousScrollLeft = scroller?.scrollLeft ?? null
      chartRef.current?.refresh(authoritativeTasks)
      disableLeftResizeHandles(container)
      if (scroller && previousScrollLeft !== null) {
        scroller.scrollLeft = previousScrollLeft
      }
      if (intent) onDirectEdit(intent)
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
    if (!forcePlanStart && scroller && scrollLeftRef.current !== null) {
      scroller.scrollLeft = scrollLeftRef.current
    }
    scrollTokenRef.current = scrollToStartToken
    highlightAffectedArrows(container, affectedPublicIds)

    return () => {
      document.removeEventListener('mouseup', finishInteraction)
      document.removeEventListener('touchend', finishInteraction)
      pendingDatesRef.current = null
      if (scroller) scrollLeftRef.current = scroller.scrollLeft
      chartRef.current = null
      container.replaceChildren()
    }
  }, [
    affectedPublicIds,
    interactionBusy,
    interactionDisabled,
    onDirectEdit,
    onTaskSelect,
    plan,
    preview,
    scrollToStartToken,
  ])

  useEffect(() => {
    if (viewModeRef.current === viewMode) return
    viewModeRef.current = viewMode
    chartRef.current?.change_view_mode(viewMode, false)
    const container = containerRef.current
    if (container) {
      disableLeftResizeHandles(container)
      highlightAffectedArrows(container, affectedPublicIds)
    }
  }, [affectedPublicIds, viewMode])

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
      className={`gantt-host ${interactionDisabled || interactionBusy ? 'gantt-interaction-disabled' : 'gantt-interactive'}`}
      ref={containerRef}
      data-testid="gantt-chart"
    />
  )
}
