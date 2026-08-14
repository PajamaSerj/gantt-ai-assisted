import { useEffect, useRef } from 'react'
import Gantt from 'frappe-gantt'

import { GANTT_SAFETY_OPTIONS } from '../gantt-config'
import {
  currentPreviewTaskId,
  ganttPreviewTasks,
  ganttTasks,
} from '../gantt-tasks'
import type { PendingPlanPreview } from '../pending-preview'
import type { PlanState, Task } from '../types'

type ViewMode = 'Day' | 'Week' | 'Month'

type GanttChartProps = {
  plan: PlanState
  preview: PendingPlanPreview | null
  affectedPublicIds: Set<string>
  viewMode: ViewMode
  scrollToStartToken: number
  onTaskSelect: (task: Task) => void
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
  onTaskSelect,
}: GanttChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<Gantt | null>(null)
  const viewModeRef = useRef(viewMode)
  const scrollLeftRef = useRef<number | null>(null)
  const scrollTokenRef = useRef<number | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const tasks = preview
      ? ganttPreviewTasks(preview)
      : ganttTasks(plan, affectedPublicIds)
    if (tasks.length === 0) return
    const byGanttId = new Map<string, Task>()
    plan.tasks.forEach((task) => {
      byGanttId.set(task.public_id, task)
      byGanttId.set(currentPreviewTaskId(task.public_id), task)
    })
    const forcePlanStart = scrollTokenRef.current !== scrollToStartToken
    chartRef.current = new Gantt(container, tasks, {
      ...GANTT_SAFETY_OPTIONS,
      view_mode: viewModeRef.current,
      scroll_to: plan.tasks[0]?.start_date ||
        preview?.proposedPlan.tasks[0]?.start_date || 'start',
      today_button: false,
      popup: false,
      container_height: 'auto',
      bar_height: 32,
      padding: 20,
      on_click: (selected) => {
        const task = byGanttId.get(selected.id)
        if (task) onTaskSelect(task)
      },
    })

    const scroller = container.querySelector<HTMLElement>('.gantt-container')
    if (!forcePlanStart && scroller && scrollLeftRef.current !== null) {
      scroller.scrollLeft = scrollLeftRef.current
    }
    scrollTokenRef.current = scrollToStartToken
    highlightAffectedArrows(container, affectedPublicIds)

    return () => {
      if (scroller) scrollLeftRef.current = scroller.scrollLeft
      chartRef.current = null
      container.replaceChildren()
    }
  }, [affectedPublicIds, onTaskSelect, plan, preview, scrollToStartToken])

  useEffect(() => {
    if (viewModeRef.current === viewMode) return
    viewModeRef.current = viewMode
    chartRef.current?.change_view_mode(viewMode, true)
    const container = containerRef.current
    if (container) highlightAffectedArrows(container, affectedPublicIds)
  }, [affectedPublicIds, viewMode])

  if (plan.tasks.length === 0 && !preview?.proposedPlan.tasks.length) {
    return (
      <div className="empty-state">
        <strong>В плане пока нет задач</strong>
        <span>Импортируйте Excel или добавьте задачу через AI-помощника.</span>
      </div>
    )
  }

  return <div className="gantt-host" ref={containerRef} data-testid="gantt-chart" />
}
