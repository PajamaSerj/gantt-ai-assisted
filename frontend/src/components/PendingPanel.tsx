import { formatPlanDate } from '../plan-view'
import type { PendingChange } from '../types'

type PendingPanelProps = {
  pending: PendingChange
  busy: boolean
  onApply: () => void
  onCancel: () => void
}

export function PendingPanel({ pending, busy, onApply, onCancel }: PendingPanelProps) {
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
        <span className="pending-count">{changeset.affected_tasks.length} задач</span>
      </div>
      <p>{pending.message}</p>

      {changeset.proposed_impacts.length > 0 && (
        <div className="impact-list">
          {changeset.proposed_impacts.map((impact) => (
            <article key={`${impact.public_id}-${impact.proposed_start_date}`}>
              <strong>{impact.public_id} · {impact.task_name}</strong>
              <span>
                {formatPlanDate(impact.current_start_date)} →{' '}
                {formatPlanDate(impact.proposed_start_date)}
              </span>
              <small>{impact.reason}</small>
            </article>
          ))}
        </div>
      )}

      {changeset.date_normalizations.map((normalization) => (
        <p className="normalization" key={`${normalization.context}-${normalization.requested_date}`}>
          Выходная дата {formatPlanDate(normalization.requested_date)} будет перенесена на{' '}
          {formatPlanDate(normalization.normalized_date)}.
        </p>
      ))}

      {changeset.confirmation_reasons.map((reason) => (
        <p className="normalization" key={reason.code}>{reason.message}</p>
      ))}

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
