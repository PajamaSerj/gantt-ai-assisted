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
const SUCCESS_NOTICE_DURATION_MS = 5_000

function initialState(): PlannerState {
  if (typeof window === 'undefined') return EMPTY_STATE
  return loadPlannerState(window.localStorage) || EMPTY_STATE
}

function pendingFromResponse(response: ChatResponse): PendingChange | null {
  const pendingChange =
    response.status === 'confirmation_required' && response.pending_changeset
      ? {
          changeset: response.pending_changeset,
          message: response.message,
          availableOptions: response.available_options,
          source: 'chat' as const,
        }
      : null
  return pendingChange
}

function planFingerprint(plan: PlannerState['plan']): string {
  return JSON.stringify(plan)
}

function App() {
  const [planner, setPlanner] = useState<PlannerState>(initialState)
  const [seedLoading, setSeedLoading] = useState(false)
  const [chatBusy, setChatBusy] = useState(false)
  const [importBusy, setImportBusy] = useState(false)
  const [applyBusy, setApplyBusy] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  const [restoreBusy, setRestoreBusy] = useState(false)
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
  const chatRequestRef = useRef(0)

  useEffect(() => {
    if (planner.plan) return
    const controller = new AbortController()
    setSeedLoading(true)
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
      .finally(() => setSeedLoading(false))
    return () => controller.abort()
  }, [planner.plan])

  useEffect(() => {
    if (planner.plan) persistPlannerState(window.localStorage, planner)
  }, [planner])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(
      () => setNotice(null),
      SUCCESS_NOTICE_DURATION_MS,
    )
    return () => window.clearTimeout(timer)
  }, [notice])

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
    if (!planner.plan || planner.pendingChange || !message.trim() || chatBusy) return
    const outgoing = message.trim()
    const requestedPlan = planner.plan
    const requestedPlanFingerprint = planFingerprint(requestedPlan)
    const requestContext = planner.conversationContext
    const requestId = chatRequestRef.current + 1
    chatRequestRef.current = requestId
    clearFeedback()
    setMessage('')
    setChatBusy(true)
    setPlanner((current) => ({
      ...current,
      conversationContext: [
        ...requestContext,
        { role: 'user', content: outgoing },
      ],
    }))
    try {
      const response = await sendChat(
        outgoing,
        requestedPlan,
        requestContext,
      )
      if (chatRequestRef.current !== requestId) return
      setPlanner((current) => {
        const requestIsCurrent =
          planFingerprint(current.plan) === requestedPlanFingerprint
        if (!requestIsCurrent) {
          return {
            ...current,
            conversationContext: [
              ...current.conversationContext,
              {
                role: 'assistant',
                content:
                  'План изменился, пока готовился ответ. Повторите запрос для актуального плана.',
              },
            ],
          }
        }
        return {
          plan: response.status === 'applied' ? response.plan : current.plan,
          conversationContext: response.conversation_context,
          pendingChange:
            response.status === 'confirmation_required'
              ? pendingFromResponse(response)
              : current.pendingChange,
        }
      })
    } catch (requestError) {
      if (chatRequestRef.current !== requestId) return
      const errorMessage =
        requestError instanceof Error
          ? requestError.message
          : 'AI-помощник временно недоступен'
      setPlanner((current) => ({
        ...current,
        conversationContext: [
          ...current.conversationContext,
          { role: 'assistant', content: `Не удалось обработать запрос. ${errorMessage}` },
        ],
      }))
    } finally {
      if (chatRequestRef.current === requestId) setChatBusy(false)
    }
  }

  function beginImport(file: File) {
    if (planner.pendingChange || chatBusy || importBusy || applyBusy || restoreBusy) return
    clearFeedback()
    setExcelMenuOpen(false)
    setImportFile(file)
  }

  async function submitImport(
    file: File,
    mode: 'replace' | 'append',
    dateConstraint: string,
  ) {
    if (!planner.plan || planner.pendingChange || chatBusy || importBusy) return
    clearFeedback()
    setImportBusy(true)
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
        throw new Error('Не удалось подготовить изменения для импорта')
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
      setImportBusy(false)
    }
  }

  async function applyPending() {
    if (!planner.plan || !planner.pendingChange || applyBusy) return
    if (!planner.pendingChange.availableOptions.includes('apply_all')) return
    clearFeedback()
    setApplyBusy(true)
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
      setApplyBusy(false)
    }
  }

  function cancelPending() {
    if (!planner.pendingChange || applyBusy) return
    setPlanner((current) => ({ ...current, pendingChange: null }))
    setNotice('Подготовленные изменения отменены. План не изменён.')
    setError(null)
  }

  async function runExport() {
    if (!planner.plan || exportBusy) return
    clearFeedback()
    setExportBusy(true)
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
      setExportBusy(false)
    }
  }

  async function restoreDemo() {
    if (restoreBusy) return
    const confirmed = window.confirm(
      'Восстановить демо-план? Текущие изменения и история AI будут удалены.',
    )
    if (!confirmed) return
    clearFeedback()
    chatRequestRef.current += 1
    setChatBusy(false)
    setRestoreBusy(true)
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
          ? `Не удалось восстановить демо-план: ${requestError.message}`
          : 'Не удалось восстановить демо-план',
      )
    } finally {
      setRestoreBusy(false)
    }
  }

  const plan = planner.plan
  const planMutationBusy = importBusy || applyBusy || restoreBusy
  const excelDisabled =
    !plan || planMutationBusy || chatBusy || Boolean(planner.pendingChange)

  return (
    <div className="app-shell">
      <header className="toolbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">AG</div>
          <div>
            <h1>AI Gantt Planner</h1>
            <p>Планирование проектов</p>
          </div>
        </div>

        <div className="toolbar-actions">
          <div className="excel-menu-wrap">
            <button
              className="toolbar-button"
              onClick={() => setExcelMenuOpen((open) => !open)}
              aria-label="Excel"
              aria-expanded={excelMenuOpen}
              disabled={excelDisabled}
            >
              <span>▦</span> Excel <span className="chevron">⌄</span>
            </button>
            {excelMenuOpen && (
              <div className="excel-menu">
                <button
                  onClick={() => toolbarFileRef.current?.click()}
                  disabled={excelDisabled}
                >
                  <span>↥</span>
                  <span><strong>Импортировать</strong><small>.xlsx, активный лист</small></span>
                </button>
                <button onClick={() => void runExport()} disabled={exportBusy}>
                  <span>↧</span>
                  <span><strong>Экспортировать</strong><small>Актуальный план в .xlsx</small></span>
                </button>
              </div>
            )}
            <input
              ref={toolbarFileRef}
              className="visually-hidden"
              aria-label="Выбрать Excel для импорта"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={excelDisabled}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) beginImport(file)
                event.target.value = ''
              }}
            />
          </div>
          <button
            className="toolbar-button restore-button"
            onClick={() => void restoreDemo()}
            disabled={planMutationBusy}
          >
            ↺ <span>Восстановить демо</span>
          </button>
          <button
            className={`ai-toolbar-button ${drawerOpen ? 'active' : ''}`}
            aria-label="AI-помощник"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen((open) => !open)}
          >
            <span>✦</span> AI
          </button>
        </div>
      </header>

      <div className={`workspace-layout ${drawerOpen ? 'with-ai' : ''}`}>
        <main className="workspace">
          <section className="workspace-heading" aria-labelledby="plan-title">
            <div>
              <h2 id="plan-title">План проекта</h2>
            </div>
            <div className="plan-stats" aria-label="Статистика плана">
              <span><strong>{plan?.tasks.length ?? '—'}</strong> задач</span>
              <span>
                <strong>
                  {plan
                    ? new Set(
                        plan.tasks.map((task) => task.assignee).filter(Boolean),
                      ).size
                    : '—'}
                </strong>{' '}
                исполнителей
              </span>
            </div>
          </section>

          {error && <div className="feedback error" role="alert"><span>!</span>{error}</div>}
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
              busy={applyBusy}
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
              {!plan && !error && seedLoading && (
                <div className="loading-state"><span />Загружаем план…</div>
              )}
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
              <span>Горизонтальная прокрутка перемещает временную шкалу</span>
              <span>Нажмите задачу, чтобы открыть детали</span>
            </div>
          </section>
        </main>

        {drawerOpen && (
          <AiDrawer
            open
            busy={chatBusy}
            pending={planner.pendingChange}
            messages={planner.conversationContext}
            message={message}
            onMessageChange={setMessage}
            onSubmit={submitChat}
            onClose={() => setDrawerOpen(false)}
            onAttach={beginImport}
          />
        )}
      </div>

      {notice && (
        <div className="toast-stack" aria-live="polite">
          <div className="feedback success toast" role="status">
            <span>✓</span>{notice}
          </div>
        </div>
      )}

      {selectedTask && plan && (
        <TaskModal plan={plan} task={selectedTask} onClose={() => setSelectedTask(null)} />
      )}
      {importFile && (
        <ImportDialog
          file={importFile}
          busy={importBusy}
          onClose={() => setImportFile(null)}
          onSubmit={submitImport}
        />
      )}
    </div>
  )
}

export default App
