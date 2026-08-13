import { useEffect, useRef } from 'react'
import Gantt, { type GanttTask } from 'frappe-gantt'

import { GANTT_SAFETY_OPTIONS } from '../gantt-config'
import type { PlanState, Task } from '../types'

type ViewMode = 'Day' | 'Week' | 'Month'

type GanttChartProps = {
  plan: PlanState
  affectedPublicIds: Set<string>
  viewMode: ViewMode
  scrollToStartToken: number
  onTaskSelect: (task: Task) => void
}

function ganttTasks(plan: PlanState, affectedPublicIds: Set<string>): GanttTask[] {
  const publicIdByInternalId = new Map(
    plan.tasks.map((task) => [task.internal_id, task.public_id]),
  )
  return plan.tasks.map((task) => ({
    id: task.public_id,
    name: task.name,
    start: task.start_date,
    end: task.end_date,
    progress: 0,
    dependencies: task.predecessor_ids
      .map((internalId) => publicIdByInternalId.get(internalId))
      .filter((publicId): publicId is string => Boolean(publicId))
      .join(', '),
    custom_class: affectedPublicIds.has(task.public_id)
      ? 'gantt-task-affected'
      : undefined,
  }))
}

export function GanttChart({
  plan,
  affectedPublicIds,
  viewMode,
  scrollToStartToken,
  onTaskSelect,
}: GanttChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container || plan.tasks.length === 0) return
    const tasks = ganttTasks(plan, affectedPublicIds)
    const byPublicId = new Map(plan.tasks.map((task) => [task.public_id, task]))
    new Gantt(container, tasks, {
      ...GANTT_SAFETY_OPTIONS,
      view_mode: viewMode,
      scroll_to: plan.tasks[0]?.start_date || 'start',
      today_button: false,
      popup: false,
      container_height: 'auto',
      bar_height: 32,
      padding: 20,
      on_click: (selected) => {
        const task = byPublicId.get(selected.id)
        if (task) onTaskSelect(task)
      },
    })

    container.querySelectorAll<SVGPathElement>('.arrow').forEach((arrow) => {
      const from = arrow.dataset.from
      const to = arrow.dataset.to
      if (
        (from && affectedPublicIds.has(from)) ||
        (to && affectedPublicIds.has(to))
      ) {
        arrow.classList.add('gantt-arrow-affected')
      }
    })

    return () => {
      container.replaceChildren()
    }
  }, [affectedPublicIds, onTaskSelect, plan, scrollToStartToken, viewMode])

  if (plan.tasks.length === 0) {
    return (
      <div className="empty-state">
        <strong>В плане пока нет задач</strong>
        <span>Импортируйте Excel или добавьте задачу через AI-помощника.</span>
      </div>
    )
  }

  return <div className="gantt-host" ref={containerRef} data-testid="gantt-chart" />
}
