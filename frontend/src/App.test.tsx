import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import App from './App'
import { persistPlannerState, STORAGE_KEY } from './storage'
import type { DirectEditIntent } from './types'
import {
  jsonResponse,
  makeChangeSet,
  makePlan,
  makeSergeyPendingScenario,
} from './test/fixtures'

vi.mock('./components/GanttChart', () => ({
  GanttChart: ({
    plan,
    preview,
    interactionDisabled,
    interactionBusy,
    onTaskSelect,
    onDirectEdit,
  }: {
    plan: ReturnType<typeof makePlan>
    preview: { proposedPlan: ReturnType<typeof makePlan>; changes: unknown[] } | null
    interactionDisabled: boolean
    interactionBusy: boolean
    onTaskSelect: (task: ReturnType<typeof makePlan>['tasks'][number]) => void
    onDirectEdit: (intent: DirectEditIntent) => void
  }) => (
    <div
      data-active-task-1-duration={plan.tasks.find((task) => task.public_id === 'TASK-001')?.duration_workdays}
      data-active-task-1-start={plan.tasks.find((task) => task.public_id === 'TASK-001')?.start_date}
      data-active-task-2-duration={plan.tasks.find((task) => task.public_id === 'TASK-002')?.duration_workdays}
      data-active-task-2-start={plan.tasks.find((task) => task.public_id === 'TASK-002')?.start_date}
      data-active-task-3-start={plan.tasks.find((task) => task.public_id === 'TASK-003')?.start_date}
      data-interaction-disabled={interactionDisabled || interactionBusy}
      data-preview-count={preview?.changes.length}
      data-preview-task-3-start={preview?.proposedPlan.tasks.find((task) => task.public_id === 'TASK-003')?.start_date}
      data-testid="gantt-chart"
    >
      {plan.tasks.map((task) => (
        <button key={task.public_id} onClick={() => onTaskSelect(task)}>
          {task.public_id} {task.name}
        </button>
      ))}
      <button
        aria-label="Имитировать прямой перенос первой задачи"
        disabled={interactionDisabled || interactionBusy}
        onClick={() => onDirectEdit({
          type: 'move',
          task: plan.tasks[0],
          intendedDate: '2026-02-03',
        })}
      >Перенос первой задачи</button>
      <button
        aria-label="Имитировать прямой перенос последней задачи"
        disabled={interactionDisabled || interactionBusy}
        onClick={() => onDirectEdit({
          type: 'move',
          task: plan.tasks[plan.tasks.length - 1],
          intendedDate: '2026-02-06',
        })}
      >Перенос последней задачи</button>
      <button
        aria-label="Имитировать resize последней задачи"
        disabled={interactionDisabled || interactionBusy}
        onClick={() => onDirectEdit({
          type: 'resize',
          task: plan.tasks[plan.tasks.length - 1],
          intendedDate: '2026-02-12',
        })}
      >Resize последней задачи</button>
    </div>
  ),
}))

function stored(plan = makePlan()) {
  persistPlannerState(localStorage, {
    plan,
    conversationContext: [],
    pendingChange: null,
  })
}

describe('Iteration 04 integration state', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('fetches seed only on first load and restores localStorage on reload', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(makePlan()))
    const first = render(<App />)

    expect(await screen.findByText(/TASK-001 Исследование продукта/)).toBeInTheDocument()
    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    first.unmount()

    render(<App />)
    expect(screen.getByText(/TASK-001 Исследование продукта/)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('applies chat response and persists the returned plan with Russian text', async () => {
    const user = userEvent.setup()
    const source = makePlan()
    const updated = makePlan('Обновлённое исследование')
    stored(source)
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        status: 'applied',
        message: 'Название обновлено.',
        plan: updated,
        conversation_context: [
          { role: 'user', content: 'Переименуй задачу' },
          { role: 'assistant', content: 'Название обновлено.' },
        ],
        pending_changeset: null,
        available_options: [],
      }),
    )
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'AI-помощник' }))
    await user.type(screen.getByLabelText('Сообщение AI-помощнику'), 'Переименуй задачу')
    await user.click(screen.getByRole('button', { name: /Отправить/ }))

    expect(await screen.findByText(/TASK-001 Обновлённое исследование/)).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}').state.plan).toEqual(updated)
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).message).toBe(
      'Переименуй задачу',
    )
  })

  it('keeps the current plan when clarification carries a stale response plan', async () => {
    const user = userEvent.setup()
    const plan = makePlan()
    stored(plan)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        status: 'clarification_required',
        message: 'Уточните конкретный день недели.',
        plan: makePlan('Устаревший план'),
        conversation_context: [
          { role: 'user', content: 'Перенеси на следующую неделю' },
          { role: 'assistant', content: 'Уточните конкретный день недели.' },
        ],
        pending_changeset: null,
        available_options: [],
      }),
    )
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'AI-помощник' }))
    await user.type(
      screen.getByLabelText('Сообщение AI-помощнику'),
      'Перенеси на следующую неделю',
    )
    await user.click(screen.getByRole('button', { name: /Отправить/ }))

    expect(await screen.findByText('Уточните конкретный день недели.')).toBeInTheDocument()
    expect(screen.getByText(/TASK-001 Исследование продукта/)).toBeInTheDocument()
    expect(screen.queryByText(/Устаревший план/)).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}').state.conversationContext).toHaveLength(2)
  })

  it('stores confirmation, blocks mutations, and cancels without an apply request', async () => {
    const user = userEvent.setup()
    const plan = makePlan()
    const changeset = makeChangeSet(plan)
    stored(plan)
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        status: 'confirmation_required',
        message: 'Перенос затронет связанные задачи.',
        plan: makePlan('Устаревший план'),
        conversation_context: [],
        pending_changeset: changeset,
        available_options: ['apply_all', 'cancel'],
      }),
    )
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'AI-помощник' }))
    await user.type(screen.getByLabelText('Сообщение AI-помощнику'), 'Перенеси задачу')
    await user.click(screen.getByRole('button', { name: /Отправить/ }))

    expect(await screen.findByText('Изменения ещё не применены')).toBeInTheDocument()
    expect(screen.getByLabelText('Сообщение AI-помощнику')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Excel' })).toBeDisabled()
    expect(screen.getByText(/TASK-001 Исследование продукта/)).toBeInTheDocument()
    expect(screen.queryByText(/Устаревший план/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Отменить' }))

    expect(screen.queryByText('Изменения ещё не применены')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Сообщение AI-помощнику')).toBeEnabled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/TASK-001 Исследование продукта/)).toBeInTheDocument()
  })

  it('applies pending ChangeSet through the backend endpoint', async () => {
    const user = userEvent.setup()
    const source = makePlan()
    const updated = makePlan('Перенесённая задача')
    const changeset = makeChangeSet(updated)
    persistPlannerState(localStorage, {
      plan: source,
      conversationContext: [],
      pendingChange: {
        changeset,
        message: 'Подтвердите перенос',
        availableOptions: ['apply_all', 'cancel'],
        source: 'chat',
      },
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ status: 'applied', plan: updated }),
    )
    render(<App />)

    expect(screen.getByTestId('gantt-chart')).toHaveAttribute(
      'data-preview-count',
      '1',
    )

    await user.click(screen.getByRole('button', { name: 'Применить всё' }))

    expect(await screen.findByText(/TASK-001 Перенесённая задача/)).toBeInTheDocument()
    expect(screen.getByTestId('gantt-chart')).not.toHaveAttribute(
      'data-preview-count',
    )
    expect(fetchMock.mock.calls[0][0]).toBe('/api/changesets/apply')
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).choice).toBe('apply_all')
  })

  it('restores seed and clears conversation and pending state', async () => {
    const user = userEvent.setup()
    const { current: seed } = makeSergeyPendingScenario()
    persistPlannerState(localStorage, {
      plan: makePlan('Изменённый план'),
      conversationContext: [{ role: 'user', content: 'Измени план' }],
      pendingChange: {
        changeset: makeChangeSet(),
        message: 'Подтвердите',
        availableOptions: ['apply_all', 'cancel'],
        source: 'chat',
      },
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(seed))
    render(<App />)

    await user.click(screen.getByRole('button', { name: /Восстановить демо/ }))

    expect(await screen.findByText(/TASK-001 Исследование продукта/)).toBeInTheDocument()
    expect(screen.getByText(/TASK-007 Подготовка демо/)).toBeInTheDocument()
    expect(window.confirm).toHaveBeenCalledWith(
      'Восстановить демо-план? Текущие изменения и история AI будут удалены.',
    )
    expect(screen.getByRole('status')).toHaveTextContent('Демо-план восстановлен.')
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}').state
    expect(saved.plan.tasks[2]).toMatchObject({
      name: 'Основа бэкенда',
      description: 'Реализовать базовую архитектуру API планировщика.',
      assignee: 'Сергей',
    })
    expect(saved.conversationContext).toEqual([])
    expect(saved.pendingChange).toBeNull()
  })

  it('opens read-only task details with public relations and no visible UUID', async () => {
    const user = userEvent.setup()
    const { current } = makeSergeyPendingScenario()
    stored(current)
    render(<App />)

    await user.click(screen.getByRole('button', {
      name: /TASK-004 Основа фронтенда/,
    }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('TASK-004')
    expect(dialog).toHaveTextContent('Зависит от')
    expect(dialog).toHaveTextContent('TASK-002 · UX-дизайн')
    expect(dialog).toHaveTextContent('Влияет на')
    expect(dialog).toHaveTextContent('TASK-005 · Интеграция приложения')
    expect(dialog).toHaveTextContent('Только просмотр')
    expect(dialog).not.toHaveTextContent('00000000-0000-4000')
  })

  it('routes toolbar and AI attachment through the same import endpoint', async () => {
    const user = userEvent.setup()
    stored()
    const validation = {
      status: 'VALIDATION_FAILED',
      unchanged_plan: makePlan(),
      changeset: null,
      errors: [{ code: 'TEST', message: 'Ошибка файла', row: 2, column: 'задача' }],
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(validation))
    render(<App />)
    const file = new File(['xlsx'], 'tasks.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    await user.click(screen.getByRole('button', { name: /Excel/ }))
    await user.upload(screen.getByLabelText('Выбрать Excel для импорта'), file)
    await user.click(screen.getByRole('button', { name: 'Проверить и импортировать' }))
    expect(await screen.findByText('Ошибка файла')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'AI-помощник' }))
    await user.upload(screen.getByLabelText('Прикрепить Excel'), file)
    await user.click(screen.getByRole('button', { name: 'Проверить и импортировать' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/import', '/api/import'])
  })

  it('keeps the current plan when provider error carries a stale plan', async () => {
    const user = userEvent.setup()
    stored()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(
        {
          status: 'provider_error',
          message: 'AI временно недоступен.',
          plan: makePlan('Устаревший план'),
          conversation_context: [
            { role: 'user', content: 'Измени задачу' },
            { role: 'assistant', content: 'AI временно недоступен.' },
          ],
          pending_changeset: null,
          available_options: [],
        },
        502,
      ),
    )
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'AI-помощник' }))
    await user.type(screen.getByLabelText('Сообщение AI-помощнику'), 'Измени задачу')
    await user.click(screen.getByRole('button', { name: /Отправить/ }))

    expect(await screen.findByText('AI временно недоступен.')).toBeInTheDocument()
    expect(screen.getByText(/TASK-001 Исследование продукта/)).toBeInTheDocument()
    expect(screen.queryByText(/Устаревший план/)).not.toBeInTheDocument()
  })

  it('shows the optimistic user turn, clears composer, and keeps the plan responsive', async () => {
    const user = userEvent.setup()
    stored()
    let resolveRequest: (response: Response) => void = () => undefined
    const pendingRequest = new Promise<Response>((resolve) => {
      resolveRequest = resolve
    })
    vi.spyOn(globalThis, 'fetch').mockReturnValue(pendingRequest)
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'AI-помощник' }))
    const composer = screen.getByLabelText('Сообщение AI-помощнику')
    await user.type(composer, 'Покажи быстрый отклик')
    await user.click(screen.getByRole('button', { name: /Отправить/ }))

    expect(screen.getByText('Покажи быстрый отклик')).toBeInTheDocument()
    expect(composer).toHaveValue('')
    const waitingStatus = screen.getByRole('status', { name: 'AI отвечает' })
    expect(waitingStatus).not.toHaveTextContent('Анализирую план')
    expect(waitingStatus.querySelectorAll('i')).toHaveLength(3)
    await user.click(screen.getByRole('button', { name: /TASK-001/ }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Исследование продукта')

    await act(async () => {
      resolveRequest(
        jsonResponse({
          status: 'clarification_required',
          message: 'Уточните действие.',
          plan: makePlan(),
          conversation_context: [
            { role: 'user', content: 'Покажи быстрый отклик' },
            { role: 'assistant', content: 'Уточните действие.' },
          ],
          pending_changeset: null,
          available_options: [],
        }),
      )
    })
    expect(await screen.findByText('Уточните действие.')).toBeInTheDocument()
  })

  it('ignores a late applied response after the local plan was restored', async () => {
    const user = userEvent.setup()
    stored(makePlan('Текущий изменённый план'))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    let resolveChat: (response: Response) => void = () => undefined
    const chatRequest = new Promise<Response>((resolve) => {
      resolveChat = resolve
    })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(chatRequest)
      .mockResolvedValueOnce(jsonResponse(makePlan('Восстановленный демо-план')))
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'AI-помощник' }))
    await user.type(screen.getByLabelText('Сообщение AI-помощнику'), 'Измени план')
    await user.click(screen.getByRole('button', { name: /Отправить/ }))
    await user.click(screen.getByRole('button', { name: /Восстановить демо/ }))
    expect(await screen.findByText(/TASK-001 Восстановленный демо-план/)).toBeInTheDocument()

    await act(async () => {
      resolveChat(
        jsonResponse({
          status: 'applied',
          message: 'Изменения применены.',
          plan: makePlan('Поздний ответ'),
          conversation_context: [],
          pending_changeset: null,
          available_options: [],
        }),
      )
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.getByText(/TASK-001 Восстановленный демо-план/)).toBeInTheDocument()
    expect(screen.queryByText(/Поздний ответ/)).not.toBeInTheDocument()
  })

  it('renders supported assistant Markdown without literal markers', async () => {
    const user = userEvent.setup()
    stored()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        status: 'clarification_required',
        message: '**Возможности**\n* Перенос задач\n* Изменение зависимостей',
        plan: makePlan(),
        conversation_context: [
          { role: 'user', content: 'Помощь' },
          {
            role: 'assistant',
            content: '**Возможности**\n* Перенос задач\n* Изменение зависимостей',
          },
        ],
        pending_changeset: null,
        available_options: [],
      }),
    )
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'AI-помощник' }))
    await user.type(screen.getByLabelText('Сообщение AI-помощнику'), 'Помощь')
    await user.click(screen.getByRole('button', { name: /Отправить/ }))

    const drawer = screen.getByRole('complementary', { name: 'AI-помощник' })
    expect(await screen.findByText('Возможности')).toHaveProperty('tagName', 'STRONG')
    expect(drawer).toHaveTextContent('Перенос задач')
    expect(drawer).not.toHaveTextContent('**Возможности**')
    expect(drawer).not.toHaveTextContent('* Перенос задач')
  })

  it('opens one desktop AI workspace panel beside the planner without a scrim', async () => {
    const user = userEvent.setup()
    stored()
    const { container } = render(<App />)

    await user.click(screen.getByRole('button', { name: 'AI-помощник' }))

    expect(container.querySelector('.workspace-layout.with-ai')).not.toBeNull()
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'AI-помощник' })).toBeInTheDocument()
    expect(container.querySelector('.drawer-scrim')).toBeNull()
    expect(screen.queryByLabelText('Открыть AI-помощника')).not.toBeInTheDocument()
    expect(screen.queryByText('Рабочая область')).not.toBeInTheDocument()
  })

  it('auto-dismisses a floating success notice after five seconds', async () => {
    const user = userEvent.setup()
    const timeoutSpy = vi.spyOn(window, 'setTimeout')
    stored()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(makePlan()))
    const { container } = render(<App />)

    await user.click(screen.getByRole('button', { name: /Восстановить демо/ }))

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Демо-план восстановлен.')
    expect(container.querySelector('.toast-stack')).not.toBeNull()
    const timerCall = timeoutSpy.mock.calls.find(([, delay]) => delay === 5_000)
    expect(timerCall).toBeDefined()

    act(() => {
      const dismiss = timerCall?.[0]
      if (typeof dismiss === 'function') dismiss()
    })

    expect(screen.queryByText('Демо-план восстановлен.')).not.toBeInTheDocument()
  })

  it('submits chat with Enter', async () => {
    const user = userEvent.setup()
    stored()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        status: 'clarification_required',
        message: 'Уточните действие.',
        plan: makePlan(),
        conversation_context: [
          { role: 'user', content: 'Помощь' },
          { role: 'assistant', content: 'Уточните действие.' },
        ],
        pending_changeset: null,
        available_options: [],
      }),
    )
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'AI-помощник' }))
    const composer = screen.getByLabelText('Сообщение AI-помощнику')
    await user.type(composer, 'Помощь{Enter}')

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).message).toBe(
      'Помощь',
    )
    expect(composer).toHaveValue('')
  })

  it('inserts a newline with Ctrl+Enter without submitting', async () => {
    const user = userEvent.setup()
    stored()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'AI-помощник' }))
    const composer = screen.getByLabelText('Сообщение AI-помощнику')
    fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter' })
    expect(fetchMock).not.toHaveBeenCalled()

    await user.type(
      composer,
      'Первая строка{Control>}{Enter}{/Control}Вторая строка',
    )

    expect(composer).toHaveValue('Первая строка\nВторая строка')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not submit Enter while IME composition is active', async () => {
    const user = userEvent.setup()
    stored()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'AI-помощник' }))
    const composer = screen.getByLabelText('Сообщение AI-помощнику')
    await user.type(composer, '入力中')
    fireEvent.compositionStart(composer)
    fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter', isComposing: true })
    fireEvent.compositionEnd(composer)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(composer).toHaveValue('入力中')
  })

  it('previews all pending positions without mutating the active plan and cancels cleanly', async () => {
    const user = userEvent.setup()
    const { current, changeset } = makeSergeyPendingScenario()
    persistPlannerState(localStorage, {
      plan: current,
      conversationContext: [],
      pendingChange: {
        changeset,
        message: 'TASK-006 must start after TASK-005 finishes',
        availableOptions: ['apply_all', 'cancel'],
        source: 'chat',
      },
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    render(<App />)

    const chart = screen.getByTestId('gantt-chart')
    expect(chart).toHaveAttribute('data-active-task-3-start', '2026-02-05')
    expect(chart).toHaveAttribute('data-preview-task-3-start', '2026-02-12')
    expect(chart).toHaveAttribute('data-preview-count', '4')
    expect(screen.getByText(
      'Вы переносите 2 задачи на 5 рабочих дней вперёд. ' +
      'Из-за зависимостей сдвинутся ещё 2 задачи.',
    )).toBeInTheDocument()
    expect(screen.getByText('5–11 февр. → 12–18 февр.')).toBeInTheDocument()
    expect(screen.getByText('3 · Основа бэкенда')).toBeInTheDocument()
    expect(screen.getByText('5 · Интеграция приложения')).toBeInTheDocument()
    expect(screen.getByText('6 · Сквозное тестирование')).toBeInTheDocument()
    expect(screen.getByText('7 · Подготовка демо')).toBeInTheDocument()
    expect(screen.getByText('Сдвинется из-за зависимости от «Интеграция приложения»')).toBeInTheDocument()
    expect(screen.queryByText(/must start after/)).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('00000000-0000-4000')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}').state.plan.tasks[2].start_date).toBe('2026-02-05')

    await user.click(screen.getByRole('button', { name: 'Отменить' }))

    expect(chart).toHaveAttribute('data-active-task-3-start', '2026-02-05')
    expect(chart).not.toHaveAttribute('data-preview-task-3-start')
    expect(screen.queryByText('Изменения ещё не применены')).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('restores a persisted pending preview after reload without applying it', () => {
    const { current, changeset } = makeSergeyPendingScenario()
    persistPlannerState(localStorage, {
      plan: current,
      conversationContext: [],
      pendingChange: {
        changeset,
        message: 'Подтвердите перенос',
        availableOptions: ['apply_all', 'cancel'],
        source: 'chat',
      },
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const first = render(<App />)

    expect(screen.getByTestId('gantt-chart')).toHaveAttribute(
      'data-preview-task-3-start',
      '2026-02-12',
    )
    first.unmount()
    render(<App />)

    expect(screen.getByTestId('gantt-chart')).toHaveAttribute(
      'data-active-task-3-start',
      '2026-02-05',
    )
    expect(screen.getByTestId('gantt-chart')).toHaveAttribute(
      'data-preview-task-3-start',
      '2026-02-12',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('prepares one direct move request and adopts an auto-applied backend plan', async () => {
    const user = userEvent.setup()
    const source = makePlan()
    const applied = structuredClone(source)
    applied.tasks[1] = {
      ...applied.tasks[1],
      start_date: '2026-02-06',
      end_date: '2026-02-11',
    }
    stored(source)
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        status: 'APPLIED',
        plan: applied,
        changeset: null,
        message: 'Изменение применено к плану.',
      }),
    )
    render(<App />)

    await user.click(screen.getByRole('button', {
      name: 'Имитировать прямой перенос последней задачи',
    }))

    await waitFor(() => expect(screen.getByTestId('gantt-chart')).toHaveAttribute(
      'data-active-task-2-start',
      '2026-02-06',
    ))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/direct-edits/prepare')
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
      current_plan: source,
      edit: {
        type: 'move',
        task_id: source.tasks[1].internal_id,
        intended_start_date: '2026-02-06',
      },
    })
  })

  it('shows a dependency-bound no-op message without creating pending state', async () => {
    const user = userEvent.setup()
    const source = makePlan()
    stored(source)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        status: 'INVALID',
        plan: source,
        changeset: null,
        message: (
          'Задача не может начинаться раньше завершения ' +
          'TASK-001 · Исследование продукта.'
        ),
      }),
    )
    render(<App />)

    await user.click(screen.getByRole('button', {
      name: 'Имитировать прямой перенос последней задачи',
    }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Задача не может начинаться раньше завершения ' +
      'TASK-001 · Исследование продукта.',
    )
    expect(screen.queryByText('Изменения ещё не применены')).not.toBeInTheDocument()
    expect(screen.getByTestId('gantt-chart')).toHaveAttribute(
      'data-active-task-2-start',
      source.tasks[1].start_date,
    )
  })

  it('keeps active dates and reuses pending preview for an impacted drag', async () => {
    const user = userEvent.setup()
    const source = makePlan()
    const proposed = structuredClone(source)
    proposed.tasks[0] = {
      ...proposed.tasks[0],
      start_date: '2026-02-03',
      end_date: '2026-02-05',
    }
    proposed.tasks[1] = {
      ...proposed.tasks[1],
      start_date: '2026-02-06',
      end_date: '2026-02-11',
    }
    const changeset = makeChangeSet(proposed)
    changeset.requested_changes = [{
      type: 'move_task',
      task_id: source.tasks[0].internal_id,
      start_date: '2026-02-03',
    }]
    changeset.affected_tasks = source.tasks.map((task) => ({
      internal_id: task.internal_id,
      public_id: task.public_id,
      name: task.name,
    }))
    changeset.proposed_impacts = [{
      internal_id: source.tasks[1].internal_id,
      public_id: source.tasks[1].public_id,
      task_name: source.tasks[1].name,
      current_start_date: source.tasks[1].start_date,
      current_end_date: source.tasks[1].end_date,
      proposed_start_date: proposed.tasks[1].start_date,
      proposed_end_date: proposed.tasks[1].end_date,
      reason: 'TASK-002 must start after TASK-001 finishes',
      dependency_internal_id: source.tasks[0].internal_id,
      dependency_public_id: source.tasks[0].public_id,
      dependency_name: source.tasks[0].name,
    }]
    stored(source)
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        status: 'CONFIRMATION_REQUIRED',
        plan: source,
        changeset,
        message: 'Проверьте последствия изменения перед применением.',
      }),
    )
    render(<App />)

    await user.click(screen.getByRole('button', {
      name: 'Имитировать прямой перенос первой задачи',
    }))

    expect(await screen.findByText('Изменения ещё не применены')).toBeInTheDocument()
    expect(screen.getByTestId('gantt-chart')).toHaveAttribute(
      'data-active-task-1-start',
      '2026-02-02',
    )
    expect(screen.getByTestId('gantt-chart')).toHaveAttribute(
      'data-interaction-disabled',
      'true',
    )
    expect(screen.getByRole('button', {
      name: 'Имитировать прямой перенос первой задачи',
    })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Отменить' }))

    expect(screen.queryByText('Изменения ещё не применены')).not.toBeInTheDocument()
    expect(screen.getByTestId('gantt-chart')).toHaveAttribute(
      'data-active-task-1-start',
      '2026-02-02',
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('prepares right-edge resize and blocks other mutations while waiting', async () => {
    const user = userEvent.setup()
    const source = makePlan()
    const applied = structuredClone(source)
    applied.tasks[1] = {
      ...applied.tasks[1],
      duration_workdays: 6,
      end_date: '2026-02-12',
    }
    stored(source)
    let resolveRequest: (response: Response) => void = () => undefined
    const responsePromise = new Promise<Response>((resolve) => {
      resolveRequest = resolve
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockReturnValue(responsePromise)
    render(<App />)

    await user.click(screen.getByRole('button', {
      name: 'Имитировать resize последней задачи',
    }))

    expect(screen.getByRole('status')).toHaveTextContent('Проверяем изменение')
    expect(screen.getByRole('button', { name: 'Excel' })).toBeDisabled()
    expect(screen.getByRole('button', {
      name: 'Имитировать прямой перенос первой задачи',
    })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'AI-помощник' }))
    expect(screen.getByLabelText('Сообщение AI-помощнику')).toBeDisabled()

    await act(async () => resolveRequest(jsonResponse({
      status: 'APPLIED',
      plan: applied,
      changeset: null,
      message: 'Изменение применено к плану.',
    })))

    await waitFor(() => expect(screen.getByTestId('gantt-chart')).toHaveAttribute(
      'data-active-task-2-duration',
      '6',
    ))
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).edit).toEqual({
      type: 'resize',
      task_id: source.tasks[1].internal_id,
      intended_end_date: '2026-02-12',
    })
  })
})
