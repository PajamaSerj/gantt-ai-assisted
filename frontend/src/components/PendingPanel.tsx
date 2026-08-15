import { compactTaskReference } from '../gantt-tasks'
import {
  formatPreviewDateRange,
  pendingPreviewSummary,
  type PendingPlanPreview,
  type PendingTaskPreview,
} from '../pending-preview'
import { formatPlanDate } from '../plan-view'
import type { PendingChange } from '../types'

type PendingPanelProps = {
  pending: PendingChange
  preview: PendingPlanPreview | null
  busy: boolean
  onApply: () => void
  onCancel: () => void
}

function taskDates(task: PendingTaskPreview['currentTask']): string | null {
  return task
    ? formatPreviewDateRange(task.start_date, task.end_date)
    : null
}

function changeDates(change: PendingTaskPreview): string {
  const current = taskDates(change.currentTask)
  const proposed = taskDates(change.proposedTask)
  if (change.kind === 'added') return `Появится в плане: ${proposed}`
  if (change.kind === 'removed') return `Будет удалена из плана (сейчас: ${current})`
  if (change.kind === 'details') return `Сроки без изменений: ${proposed}`
  return `${current} → ${proposed}`
}

function changeReason(change: PendingTaskPreview): string {
  if (change.source === 'dependency') {
    return change.dependencyName
      ? `Сдвинется из-за зависимости от «${change.dependencyName}»`
      : 'Сдвинется из-за зависимости'
  }
  if (change.source === 'direct') return 'Запрошенное изменение'
  return 'Связанное изменение'
}

export function PendingPanel({
  pending,
  preview,
  busy,
  onApply,
  onCancel,
}: PendingPanelProps) {
  if (!preview || preview.changes.length === 0) return null

  const changeset = pending.changeset
  const canApply = pending.availableOptions.includes('apply_all')
  const canCancel = pending.availableOptions.includes('cancel')

  return (
    <aside className="pending-panel" aria-labelledby="pending-title">
      <div className="pending-heading">
        <div>
          <p className="eyebrow">Требуется решение</p>
          <h2 id="pending-title">Изменения ещё не применены</h2>
        </div>
        <span className="pending-count">
          {preview.changes.length} задач
        </span>
      </div>
      <p>{pendingPreviewSummary(preview)}</p>

      <div className="pending-change-list">
        {preview.changes.map((change) => (
          <article key={change.internalId}>
            <strong>
              {compactTaskReference(change.publicId)} · {change.name}
            </strong>
            <span>{changeDates(change)}</span>
            <small className={`change-source ${change.source}`}>
              {changeReason(change)}
            </small>
          </article>
        ))}
      </div>

      {changeset.date_normalizations.map((normalization) => (
        <p className="normalization" key={`${normalization.context}-${normalization.requested_date}`}>
          Выходная дата {formatPlanDate(normalization.requested_date)} будет перенесена на{' '}
          {formatPlanDate(normalization.normalized_date)}.
        </p>
      ))}

      {changeset.confirmation_reasons.map((reason, index) => {
        const assignees = reason.code === 'NEW_ASSIGNEE'
          ? [...new Set(
              preview.proposedPlan.tasks
                .filter((task) => reason.task_public_ids.includes(task.public_id))
                .map((task) => task.assignee)
                .filter((assignee): assignee is string => Boolean(assignee)),
            )]
          : []
        const message = assignees.length > 0
          ? `Новый исполнитель ${assignees.map((name) => `«${name}»`).join(', ')} будет добавлен после подтверждения.`
          : 'Изменение требует дополнительного подтверждения.'
        return (
          <p className="normalization" key={`${reason.code}-${index}`}>{message}</p>
        )
      })}

      <div className="pending-actions">
        {canCancel && (
          <button className="secondary-button" onClick={onCancel} disabled={busy}>
            Отменить
          </button>
        )}
        {canApply && (
          <button className="primary-button" onClick={onApply} disabled={busy}>
            {busy ? 'Применяем…' : 'Применить всё'}
          </button>
        )}
      </div>
    </aside>
  )
}
