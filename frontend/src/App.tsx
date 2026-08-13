import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import './App.css'
import {
  applyChangeSet,
  downloadWorkbook,
  exportWorkbook,
  fetchSeed,
  importWorkbook,
  sendChat,
} from './api'
import { AiDrawer } from './components/AiDrawer'
import { GanttChart } from './components/GanttChart'
import { ImportDialog } from './components/ImportDialog'
import { PendingPanel } from './components/PendingPanel'
import { TaskModal } from './components/TaskModal'
import { loadPlannerState, persistPlannerState } from './storage'
import type {
  ChatResponse,
  ImportIssue,
  PendingChange,
  PlannerState,
  Task,
} from './types'

const EMPTY_STATE: PlannerState = {
  plan: null,
  conversationContext: [],
  pendingChange: null,
}

const IMPORT_CONFIRMATION_OPTIONS = ['apply_all', 'cancel']

function initialState(): PlannerState {
  if (typeof window === 'undefined') return EMPTY_STATE
  return loadPlannerState(window.localStorage) || EMPTY_STATE
}

function responseState(response: ChatResponse): PlannerState {
  const pendingChange =
    response.status === 'confirmation_required' && response.pending_changeset
      ? {
          changeset: response.pending_changeset,
          message: response.message,
          availableOptions: response.available_options,
          source: 'chat' as const,
        }
      : null
  return {
    plan: response.plan,
    conversationContext: response.conversation_context,
    pendingChange,
  }
}

function App() {
  const [planner, setPlanner] = useState<PlannerState>(initialState)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [importIssues, setImportIssues] = useState<ImportIssue[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [excelMenuOpen, setExcelMenuOpen] = useState(false)
  const [viewMode, setViewMode] = useState<'Day' | 'Week' | 'Month'>('Week')
  const [scrollToStartToken, setScrollToStartToken] = useState(1)
  const toolbarFileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (planner.plan) return
    const controller = new AbortController()
    setBusy(true)
    void fetchSeed(controller.signal)
      .then((plan) => {
        setPlanner({ plan, conversationContext: [], pendingChange: null })
        setScrollToStartToken((value) => value + 1)
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof Error && requestError.name !== 'AbortError') {
          setError(`Не удалось загрузить демо-план: ${requestError.message}`)
        }
      })
      .finally(() => setBusy(false))
    return () => controller.abort()
  }, [planner.plan])

  useEffect(() => {
    if (planner.plan) persistPlannerState(window.localStorage, planner)
  }, [planner])

  const affectedPublicIds = useMemo(() => {
    const pending = planner.pendingChange?.changeset
    if (!pending) return new Set<string>()
    return new Set([
      ...pending.affected_tasks.map((task) => task.public_id),
      ...pending.conflicts.flatMap((conflict) => [
        ...(conflict.task_public_id ? [conflict.task_public_id] : []),
        ...conflict.related_task_public_ids,
      ]),
    ])
  }, [planner.pendingChange])

  const selectTask = useCallback((task: Task) => setSelectedTask(task), [])

  function clearFeedback() {
    setError(null)
    setNotice(null)
    setImportIssues([])
  }

  async function submitChat() {
    if (!planner.plan || planner.pendingChange || !message.trim() || busy) return
    const outgoing = message.trim()
    clearFeedback()
    setBusy(true)
    try {
      const response = await sendChat(
        outgoing,
        planner.plan,
        planner.conversationContext,
      )
      setPlanner(responseState(response))
      setMessage('')
      if (response.status === 'provider_error') setError(response.message)
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'AI-помощник временно недоступен',
      )
    } finally {
      setBusy(false)
    }
  }

  function beginImport(file: File) {
    if (planner.pendingChange || busy) return
    clearFeedback()
    setExcelMenuOpen(false)
    setImportFile(file)
  }

  async function submitImport(
    file: File,
    mode: 'replace' | 'append',
    dateConstraint: string,
  ) {
    if (!planner.plan || planner.pendingChange || busy) return
    clearFeedback()
    setBusy(true)
    try {
      const response = await importWorkbook(
        file,
        mode,
        dateConstraint,
        planner.plan,
      )
      if (response.status === 'VALIDATION_FAILED') {
        setImportIssues(response.errors)
        setImportFile(null)
        return
      }
      if (!response.changeset) {
        throw new Error('Backend не вернул подготовленный ChangeSet')
      }
      if (response.status === 'CONFIRMATION_REQUIRED') {
        const pending: PendingChange = {
          changeset: response.changeset,
          message: 'Импорт подготовлен. Проверьте рассчитанные последствия перед применением.',
          availableOptions: IMPORT_CONFIRMATION_OPTIONS,
          source: 'import',
        }
        setPlanner((current) => ({ ...current, pendingChange: pending }))
        setImportFile(null)
        return
      }

      const applied = await applyChangeSet(
        planner.plan,
        response.changeset,
        'apply_all',
      )
      setPlanner((current) => ({
        ...current,
        plan: applied.plan,
        pendingChange: null,
      }))
      setSelectedTask(null)
      setImportFile(null)
      setNotice('Excel успешно импортирован.')
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Не удалось импортировать Excel',
      )
    } finally {
      setBusy(false)
    }
  }

  async function applyPending() {
    if (!planner.plan || !planner.pendingChange || busy) return
    if (!planner.pendingChange.availableOptions.includes('apply_all')) return
    clearFeedback()
    setBusy(true)
    try {
      const result = await applyChangeSet(
        planner.plan,
        planner.pendingChange.changeset,
        'apply_all',
      )
      setPlanner((current) => ({
        ...current,
        plan: result.plan,
        pendingChange: null,
      }))
      setSelectedTask(null)
      setNotice('Изменения применены к плану.')
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Не удалось применить ChangeSet',
      )
    } finally {
      setBusy(false)
    }
  }

  function cancelPending() {
    if (!planner.pendingChange || busy) return
    setPlanner((current) => ({ ...current, pendingChange: null }))
    setNotice('Подготовленные изменения отменены. План не изменён.')
    setError(null)
  }

  async function runExport() {
    if (!planner.plan || busy) return
    clearFeedback()
    setBusy(true)
    setExcelMenuOpen(false)
    try {
      downloadWorkbook(await exportWorkbook(planner.plan))
      setNotice('Excel-файл подготовлен к скачиванию.')
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Не удалось экспортировать план',
      )
    } finally {
      setBusy(false)
    }
  }

  async function restoreDemo() {
    if (busy) return
    const confirmed = window.confirm(
      'Восстановить исходный демо-план? Текущие изменения и история AI будут удалены.',
    )
    if (!confirmed) return
    clearFeedback()
    setBusy(true)
    try {
      const plan = await fetchSeed()
      setPlanner({ plan, conversationContext: [], pendingChange: null })
      setSelectedTask(null)
      setMessage('')
      setImportFile(null)
      setDrawerOpen(false)
      setScrollToStartToken((value) => value + 1)
      setNotice('Демо-план восстановлен.')
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Не удалось восстановить демо-план',
      )
    } finally {
      setBusy(false)
    }
  }

  const plan = planner.plan

  return (
    <div className="app-shell">
      <header className="toolbar">
        <div className="brand-lockup">
          <div className="brand-mark">G</div>
          <div>
            <p className="eyebrow">PajamaTech planning</p>
            <h1>AI Gantt Planner</h1>
          </div>
        </div>

        <div className="toolbar-actions">
          <div className="excel-menu-wrap">
            <button
              className="toolbar-button"
              onClick={() => setExcelMenuOpen((open) => !open)}
              aria-label="Excel"
              aria-expanded={excelMenuOpen}
              disabled={!plan || busy}
            >
              <span>▦</span> Excel <span className="chevron">⌄</span>
            </button>
            {excelMenuOpen && (
              <div className="excel-menu">
                <button
                  onClick={() => toolbarFileRef.current?.click()}
                  disabled={Boolean(planner.pendingChange)}
                >
                  <span>↥</span>
                  <span><strong>Импортировать</strong><small>.xlsx, активный лист</small></span>
                </button>
                <button onClick={() => void runExport()}>
                  <span>↧</span>
                  <span><strong>Экспортировать</strong><small>Текущий снимок плана</small></span>
                </button>
              </div>
            )}
            <input
              ref={toolbarFileRef}
              className="visually-hidden"
              aria-label="Выбрать Excel для импорта"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={busy || Boolean(planner.pendingChange)}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) beginImport(file)
                event.target.value = ''
              }}
            />
          </div>
          <button className="toolbar-button restore-button" onClick={() => void restoreDemo()} disabled={busy}>
            ↺ <span>Восстановить демо</span>
          </button>
          <button
            className="ai-toolbar-button"
            aria-label="AI-помощник"
            onClick={() => setDrawerOpen(true)}
          >
            <span>✦</span> AI-помощник
          </button>
        </div>
      </header>

      <main className="workspace">
        <section className="hero-copy" aria-labelledby="plan-title">
          <div>
            <p className="eyebrow">Текущий план</p>
            <h2 id="plan-title">Проект на одной временной шкале</h2>
            <p>Все даты и зависимости рассчитаны детерминированным backend.</p>
          </div>
          <div className="plan-stats" aria-label="Статистика плана">
            <div><strong>{plan?.tasks.length ?? '—'}</strong><span>задач</span></div>
            <div><strong>{plan ? new Set(plan.tasks.map((task) => task.assignee).filter(Boolean)).size : '—'}</strong><span>исполнителей</span></div>
          </div>
        </section>

        {error && <div className="feedback error" role="alert"><span>!</span>{error}</div>}
        {notice && <div className="feedback success" role="status"><span>✓</span>{notice}</div>}
        {importIssues.length > 0 && (
          <section className="validation-panel" aria-labelledby="validation-title">
            <div>
              <p className="eyebrow">Импорт не применён</p>
              <h3 id="validation-title">Исправьте ошибки в Excel</h3>
            </div>
            <ul>
              {importIssues.map((issue, index) => (
                <li key={`${issue.code}-${issue.row}-${index}`}>
                  <strong>{issue.row ? `Строка ${issue.row}` : issue.code}</strong>
                  <span>{issue.message}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {planner.pendingChange && (
          <PendingPanel
            pending={planner.pendingChange}
            busy={busy}
            onApply={() => void applyPending()}
            onCancel={cancelPending}
          />
        )}

        <section className="gantt-card" aria-label="Диаграмма Гантта">
          <div className="gantt-card-header">
            <div className="legend">
              <span><i className="legend-dot active" />Задачи</span>
              {planner.pendingChange && <span><i className="legend-dot affected" />Затронуты</span>}
            </div>
            <label className="view-control">
              Масштаб
              <select value={viewMode} onChange={(event) => setViewMode(event.target.value as typeof viewMode)}>
                <option value="Day">Дни</option>
                <option value="Week">Недели</option>
                <option value="Month">Месяцы</option>
              </select>
            </label>
          </div>

          <div className="gantt-stage">
            {!plan && !error && <div className="loading-state"><span />Загружаем демо-план…</div>}
            {plan && (
              <GanttChart
                plan={plan}
                affectedPublicIds={affectedPublicIds}
                viewMode={viewMode}
                scrollToStartToken={scrollToStartToken}
                onTaskSelect={selectTask}
              />
            )}
          </div>
          <div className="gantt-footer">
            <span>↔ Прокручивайте шкалу горизонтально</span>
            <span>Выберите задачу, чтобы увидеть детали</span>
          </div>
        </section>
      </main>

      <button
        className={`ai-fab ${drawerOpen ? 'drawer-visible' : ''}`}
        onClick={() => setDrawerOpen(true)}
        aria-label="Открыть AI-помощника"
      >
        <span>✦</span>
        <strong>Спросить AI</strong>
      </button>

      {drawerOpen && <button className="drawer-scrim" aria-label="Закрыть панель" onClick={() => setDrawerOpen(false)} />}
      {drawerOpen && (
        <AiDrawer
          open
          busy={busy}
          pending={planner.pendingChange}
          messages={planner.conversationContext}
          message={message}
          onMessageChange={setMessage}
          onSubmit={submitChat}
          onClose={() => setDrawerOpen(false)}
          onAttach={beginImport}
        />
      )}

      {selectedTask && plan && (
        <TaskModal plan={plan} task={selectedTask} onClose={() => setSelectedTask(null)} />
      )}
      {importFile && (
        <ImportDialog
          file={importFile}
          busy={busy}
          onClose={() => setImportFile(null)}
          onSubmit={submitImport}
        />
      )}
    </div>
  )
}

export default App
