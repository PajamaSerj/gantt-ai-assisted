import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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

  it('keeps the plan on clarification and persists conversation context', async () => {
    const user = userEvent.setup()
    const plan = makePlan()
    stored(plan)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        status: 'clarification_required',
        message: 'Уточните конкретный день недели.',
        plan,
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
        plan,
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
    await user.click(screen.getByRole('button', { name: 'Excel' }))
    expect(screen.getByRole('button', { name: /Импортировать/ })).toBeDisabled()
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
    expect(dialog).toHaveTextContent('TASK-001 Исследование продукта')
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
})
