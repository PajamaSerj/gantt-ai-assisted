import { useEffect, useState, type FormEvent } from 'react'

type ImportDialogProps = {
  file: File
  busy: boolean
  onClose: () => void
  onSubmit: (
    file: File,
    mode: 'replace' | 'append',
    dateConstraint: string,
  ) => Promise<void>
}

function todayIso(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function ImportDialog({ file, busy, onClose, onSubmit }: ImportDialogProps) {
  const [mode, setMode] = useState<'replace' | 'append'>('append')
  const [dateConstraint, setDateConstraint] = useState(todayIso)

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [busy, onClose])

  async function submit(event: FormEvent) {
    event.preventDefault()
    await onSubmit(file, mode, dateConstraint)
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form
        aria-labelledby="import-dialog-title"
        aria-modal="true"
        className="modal-card import-modal"
        onSubmit={(event) => void submit(event)}
        role="dialog"
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">Детерминированный импорт</p>
            <h2 id="import-dialog-title">Импортировать Excel</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>
        <p className="file-summary">{file.name}</p>

        <fieldset className="segmented-fieldset" disabled={busy}>
          <legend>Как применить задачи?</legend>
          <label className={mode === 'append' ? 'selected' : ''}>
            <input
              type="radio"
              name="mode"
              value="append"
              checked={mode === 'append'}
              onChange={() => setMode('append')}
            />
            <strong>Дополнить</strong>
            <span>Сохранить текущий план</span>
          </label>
          <label className={mode === 'replace' ? 'selected' : ''}>
            <input
              type="radio"
              name="mode"
              value="replace"
              checked={mode === 'replace'}
              onChange={() => setMode('replace')}
            />
            <strong>Заменить</strong>
            <span>Создать новый план</span>
          </label>
        </fieldset>

        <label className="field-label">
          {mode === 'replace'
            ? 'Дата начала плана'
            : 'Не раньше какой даты начинать новые задачи?'}
          <input
            type="date"
            value={dateConstraint}
            onChange={(event) => setDateConstraint(event.target.value)}
            required
            disabled={busy}
          />
        </label>

        <p className="helper-text">
          Будет обработан только активный лист `.xlsx`. Файл не отправляется AI-модели.
        </p>
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button className="primary-button" type="submit" disabled={busy || !dateConstraint}>
            {busy ? 'Проверяем…' : 'Проверить и импортировать'}
          </button>
        </div>
      </form>
    </div>
  )
}
