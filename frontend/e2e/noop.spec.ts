import {
  dragTask,
  expect,
  expectChartUnlocked,
  restoreDemo,
  test,
} from './qa-fixtures'

type ApiPlan = {
  tasks: Array<{
    internal_id: string
    public_id: string
    name: string
    start_date: string
    end_date: string
  }>
}

function zeroEffectChangeSet(plan: ApiPlan) {
  const task = plan.tasks.find((candidate) => candidate.public_id === 'TASK-004')!
  const predecessor = plan.tasks.find(
    (candidate) => candidate.public_id === 'TASK-002',
  )!
  return {
    changeset_id: '00000000-0000-4000-8000-000000000099',
    source_plan_digest: 'defensive-e2e-digest',
    requested_changes: [{
      type: 'move_task',
      task_id: task.internal_id,
      start_date: '2026-02-10',
    }],
    affected_tasks: [{
      internal_id: task.internal_id,
      public_id: task.public_id,
      name: task.name,
    }],
    conflicts: [],
    proposed_impacts: [{
      internal_id: task.internal_id,
      public_id: task.public_id,
      task_name: task.name,
      current_start_date: task.start_date,
      current_end_date: task.end_date,
      proposed_start_date: task.start_date,
      proposed_end_date: task.end_date,
      reason: 'TASK-004 must start after TASK-002 finishes',
      dependency_internal_id: predecessor.internal_id,
      dependency_public_id: predecessor.public_id,
      dependency_name: predecessor.name,
    }],
    date_normalizations: [],
    confirmation_reasons: [],
    status: 'CONFIRMATION_REQUIRED',
    proposed_plan: plan,
  }
}

test('captured dependency-bound AI move remains a usable no-op', async ({
  qaPage: page,
}) => {
  await restoreDemo(page)
  await page.route('**/api/chat', async (route) => {
    const request = route.request().postDataJSON() as {
      message: string
      plan: ApiPlan
      conversation_context: Array<{ role: string; content: string }>
    }
    const reply = request.message.includes('Елены')
      ? (
          'Задачу 4 нельзя перенести раньше: она уже начинается в первый ' +
          'рабочий день после TASK-002 · UX-дизайн — 11 февраля.'
        )
      : 'Уточните, какое изменение требуется.'
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'clarification_required',
        message: reply,
        plan: request.plan,
        conversation_context: [
          ...request.conversation_context,
          { role: 'user', content: request.message },
          { role: 'assistant', content: reply },
        ],
        pending_changeset: null,
        available_options: [],
      }),
    })
  })

  const task4Before = await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('ai-gantt-planner:v1')!)
    return stored.state.plan.tasks.find(
      (task: { public_id: string }) => task.public_id === 'TASK-004',
    ).start_date
  })
  await page.getByRole('button', { name: 'AI-помощник' }).click()
  const composer = page.getByLabel('Сообщение AI-помощнику')
  await composer.fill('Перенеси задачу Елены на день назад')
  await page.getByRole('button', { name: /Отправить/ }).click()

  await expect(page.getByText(/первый рабочий день после TASK-002/)).toBeVisible()
  await expect(page.getByRole('heading', {
    name: 'Изменения ещё не применены',
  })).toHaveCount(0)
  await expect(page.getByText('0 задач')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Применить всё' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Отменить' })).toHaveCount(0)
  await expect(page.locator('.gantt-preview-overlay')).toHaveCount(0)
  await expect(composer).toBeEnabled()
  await composer.fill('Продолжим')
  await page.getByRole('button', { name: /Отправить/ }).click()
  await expect(page.getByText('Уточните, какое изменение требуется.')).toBeVisible()

  const task4After = await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('ai-gantt-planner:v1')!)
    return stored.state.plan.tasks.find(
      (task: { public_id: string }) => task.public_id === 'TASK-004',
    ).start_date
  })
  expect(task4After).toBe(task4Before)
  await expectChartUnlocked(page)
  await dragTask(page, 'TASK-007', 50)
  await expect(page.getByText('Новая дата задачи применена.')).toBeVisible()
  await expectChartUnlocked(page)
})

test('frontend refuses a malformed zero-effect confirmation', async ({
  qaPage: page,
}) => {
  await page.route('**/api/chat', async (route) => {
    const request = route.request().postDataJSON() as {
      message: string
      plan: ApiPlan
      conversation_context: Array<{ role: string; content: string }>
    }
    const message = 'После проверки правил план остаётся без изменений.'
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'confirmation_required',
        message,
        plan: request.plan,
        conversation_context: [
          ...request.conversation_context,
          { role: 'user', content: request.message },
          { role: 'assistant', content: message },
        ],
        pending_changeset: zeroEffectChangeSet(request.plan),
        available_options: ['apply_all', 'cancel'],
      }),
    })
  })

  await page.getByRole('button', { name: 'AI-помощник' }).click()
  const composer = page.getByLabel('Сообщение AI-помощнику')
  await composer.fill('Перенеси задачу Елены на день назад')
  await page.getByRole('button', { name: /Отправить/ }).click()

  await expect(page.getByText(
    'После проверки правил план остаётся без изменений.',
  )).toBeVisible()
  await expect(page.getByRole('heading', {
    name: 'Изменения ещё не применены',
  })).toHaveCount(0)
  await expect(page.getByText('0 задач')).toHaveCount(0)
  await expect(page.locator('.gantt-preview-overlay')).toHaveCount(0)
  await expect(composer).toBeEnabled()
  await expectChartUnlocked(page)
})
