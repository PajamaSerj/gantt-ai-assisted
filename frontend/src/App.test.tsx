import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import App from './App'
import { persistPlannerState, STORAGE_KEY } from './storage'
import { jsonResponse, makeChangeSet, makePlan } from './test/fixtures'

vi.mock('./components/GanttChart', () => ({
  GanttChart: ({ plan, onTaskSelect }: { plan: ReturnType<typeof makePlan>; onTaskSelect: (task: ReturnType<typeof makePlan>['tasks'][number]) => void }) => (
    <div data-testid="gantt-chart">
      {plan.tasks.map((task) => (
        <button key={task.public_id} onClick={() => onTaskSelect(task)}>
          {task.public_id} {task.name}
        </button>
      ))}
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

    await user.click(screen.getByRole('button', { name: 'Применить всё' }))

    expect(await screen.findByText(/TASK-001 Перенесённая задача/)).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/changesets/apply')
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).choice).toBe('apply_all')
  })

  it('restores seed and clears conversation and pending state', async () => {
    const user = userEvent.setup()
    const seed = makePlan()
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
    expect(window.confirm).toHaveBeenCalledWith(
      'Восстановить демо-план? Текущие изменения и история AI будут удалены.',
    )
    expect(screen.getByRole('status')).toHaveTextContent('Демо-план восстановлен.')
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}').state
    expect(saved.conversationContext).toEqual([])
    expect(saved.pendingChange).toBeNull()
  })

  it('opens read-only task details with public relations and no visible UUID', async () => {
    const user = userEvent.setup()
    stored()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /TASK-002 UX-дизайн/ }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('TASK-002')
    expect(dialog).toHaveTextContent('Зависит от')
    expect(dialog).toHaveTextContent('1 · Исследование продукта')
    expect(dialog).toHaveTextContent('Влияет на')
    expect(dialog).not.toHaveTextContent('TASK-001')
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
})
