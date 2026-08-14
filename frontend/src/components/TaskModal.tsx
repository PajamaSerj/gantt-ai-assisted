import { useEffect } from 'react'

import { compactTaskReference } from '../gantt-tasks'
import { buildTaskDetails, formatPlanDate } from '../plan-view'
import type { PlanState, Task } from '../types'

type TaskModalProps = {
  plan: PlanState
  task: Task
  onClose: () => void
}

function RelationList({
  items,
}: {
  items: { publicId: string; name: string }[]
}) {
  if (items.length === 0) return <span className="muted">Нет</span>
  return (
    <ul className="relation-list">
      {items.map((item) => (
        <li key={item.publicId}>
          <span>{compactTaskReference(item.publicId)}</span> · {item.name}
        </li>
      ))}
    </ul>
  )
}

export function TaskModal({ plan, task, onClose }: TaskModalProps) {
  const details = buildTaskDetails(plan, task)

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-labelledby="task-modal-title"
        aria-modal="true"
        className="modal-card task-modal"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="modal-header">
          <div>
            <span className="task-id-chip">{task.public_id}</span>
            <h2 id="task-modal-title">{task.name}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </div>

        <dl className="task-details-grid">
          <div className="details-wide">
            <dt>Описание</dt>
            <dd>{task.description || <span className="muted">Не указано</span>}</dd>
          </div>
          <div>
            <dt>Исполнитель</dt>
            <dd>{task.assignee || <span className="muted">Не назначен</span>}</dd>
          </div>
          <div>
            <dt>Длительность</dt>
            <dd>{task.duration_workdays} раб. дн.</dd>
          </div>
          <div>
            <dt>Начало</dt>
            <dd>{formatPlanDate(task.start_date)}</dd>
          </div>
          <div>
            <dt>Окончание</dt>
            <dd>{formatPlanDate(task.end_date)}</dd>
          </div>
          <div>
            <dt>Зависит от</dt>
            <dd><RelationList items={details.predecessors} /></dd>
          </div>
          <div>
            <dt>Влияет на</dt>
            <dd><RelationList items={details.successors} /></dd>
          </div>
        </dl>

        <div className="modal-footer">
          <span>Только просмотр</span>
          <button className="secondary-button" onClick={onClose}>Закрыть</button>
        </div>
      </section>
    </div>
  )
}
