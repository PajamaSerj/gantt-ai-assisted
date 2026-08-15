import {
  dragTask,
  expect,
  expectChartUnlocked,
  restoreDemo,
  taskBarBox,
  test,
} from './qa-fixtures'

test('safe edit survives reload, help chat preserves it, and Restore clears state', async ({
  qaPage: page,
}) => {
  const original = await taskBarBox(page, 'TASK-007')
  await dragTask(page, 'TASK-007', 50)
  await expect(page.getByText('Новая дата задачи применена.')).toBeVisible()
  const moved = await taskBarBox(page, 'TASK-007')
  expect(moved.x).toBeGreaterThan(original.x)

  await page.reload()
  await expect(page.locator('.bar-wrapper')).toHaveCount(7)
  const reloaded = await taskBarBox(page, 'TASK-007')
  expect(Math.abs(reloaded.x - moved.x)).toBeLessThanOrEqual(1)
  await expect(page.locator('.gantt-preview-overlay')).toHaveCount(0)

  await page.route('**/api/chat', async (route) => {
    const request = route.request().postDataJSON() as {
      message: string
      plan: { tasks: unknown[] }
      conversation_context: Array<{ role: string; content: string }>
    }
    const reply = (
      'Могу переносить задачи и группы задач, менять исполнителей и зависимости, ' +
      'добавлять новые задачи и помогать перестраивать план.'
    )
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
  await page.getByRole('button', { name: 'AI-помощник' }).click()
  await page.getByLabel('Сообщение AI-помощнику').fill('Что ты умеешь?')
  await page.getByRole('button', { name: /Отправить/ }).click()
  await expect(page.getByText(
    /Могу переносить задачи и группы задач/,
  )).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть AI-помощника' }).click()
  const afterHelp = await taskBarBox(page, 'TASK-007')
  expect(Math.abs(afterHelp.x - moved.x)).toBeLessThanOrEqual(1)

  const storageAudit = await page.evaluate(() => ({
    keys: Object.keys(localStorage),
    values: Object.values(localStorage),
  }))
  expect(storageAudit.keys).toEqual(['ai-gantt-planner:v1'])
  expect(storageAudit.values.join(' ')).not.toMatch(
    /(api[_-]?key|password|secret|bearer\s+[a-z0-9._-]+)/i,
  )

  await restoreDemo(page)
  const restored = await taskBarBox(page, 'TASK-007')
  expect(Math.abs(restored.x - original.x)).toBeLessThanOrEqual(1)
  await expect(page.getByRole('complementary', {
    name: 'AI-помощник',
  })).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.gantt-preview-overlay')).toHaveCount(0)
})

test('exported workbook re-imports through the normal deterministic flow', async ({
  qaPage: page,
}, testInfo) => {
  await page.getByRole('button', { name: 'Excel', exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /Экспортировать/ }).click()
  const download = await downloadPromise
  const workbookPath = testInfo.outputPath('roundtrip.xlsx')
  await download.saveAs(workbookPath)
  await expect(page.getByText('Excel-файл подготовлен к скачиванию.')).toBeVisible()

  await page.getByLabel('Выбрать Excel для импорта').setInputFiles(workbookPath)
  await expect(page.getByRole('dialog', {
    name: 'Импортировать Excel',
  })).toBeVisible()
  await page.getByLabel('Заменить').check()
  await page.getByLabel('Дата начала плана').fill('2026-02-02')
  await page.getByRole('button', {
    name: 'Проверить и импортировать',
  }).click()

  await expect(page.getByRole('dialog')).toHaveCount(0)

  const pending = page.getByRole('heading', {
    name: 'Изменения ещё не применены',
  })
  if (await pending.isVisible()) {
    await page.getByRole('button', { name: 'Применить всё' }).click()
  }
  await expect(page.locator('.bar-wrapper')).toHaveCount(7)
  await expect.poll(async () => page.locator('.bar-wrapper .bar').evaluateAll(
    (bars) => new Set(bars.map((bar) => bar.getAttribute('y'))).size,
  )).toBe(7)
  await expectChartUnlocked(page)

  await page.locator('.bar-wrapper[data-id="TASK-001"] .bar').click()
  await expect(page.getByRole('dialog', {
    name: 'Исследование продукта',
  })).toBeVisible()
  await expect(page.getByRole('dialog')).not.toContainText(
    /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}/i,
  )
})
