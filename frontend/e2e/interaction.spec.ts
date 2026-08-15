import {
  directEditRequests,
  dragTask,
  expect,
  expectChartUnlocked,
  resizeTask,
  taskBarBox,
  test,
} from './qa-fixtures'

test.describe('Gantt gesture intent and confirmation lifecycle', () => {
  test('plain click, micro-drag and unchanged resize remain distinct', async ({
    qaPage: page,
  }) => {
    const requests = directEditRequests(page)
    const task = page.locator('.bar-wrapper[data-id="TASK-001"] .bar')

    await task.click()
    await expect(page.getByRole('dialog', { name: 'Исследование продукта' })).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Закрыть' }).last().click()

    await dragTask(page, 'TASK-001', 4)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(requests).toHaveLength(0)

    await task.click()
    await expect(page.getByRole('dialog', { name: 'Исследование продукта' })).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Закрыть' }).last().click()

    await resizeTask(page, 'TASK-001', 2)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(requests).toHaveLength(0)
    await expectChartUnlocked(page)
  })

  test('impacted drag Apply never replays the original gesture as a modal click', async ({
    qaPage: page,
  }) => {
    const requests = directEditRequests(page)
    await dragTask(page, 'TASK-005', 50)

    await expect(page.getByRole('heading', {
      name: 'Изменения ещё не применены',
    })).toBeVisible()
    expect(requests).toHaveLength(1)
    await expect(page.locator('.gantt-preview-item')).toHaveCount(3)
    await expect(page.locator('.bar-wrapper')).toHaveCount(7)

    await page.getByRole('button', { name: 'Применить всё' }).click()
    await expect(page.getByRole('heading', {
      name: 'Изменения ещё не применены',
    })).toHaveCount(0)
    await expect(page.locator('.gantt-preview-overlay')).toHaveCount(0)
    await page.waitForTimeout(400)

    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expectChartUnlocked(page)

    await page.locator('.bar-wrapper[data-id="TASK-005"] .bar').click()
    await expect(page.getByRole('dialog', {
      name: 'Интеграция приложения',
    })).toBeVisible()
  })

  test('safe drag and resize each emit one request and keep the task usable', async ({
    qaPage: page,
  }) => {
    const requests = directEditRequests(page)
    const original = await taskBarBox(page, 'TASK-007')

    await dragTask(page, 'TASK-007', 50)
    await expect(page.getByText('Новая дата задачи применена.')).toBeVisible()
    expect(requests).toHaveLength(1)
    await expectChartUnlocked(page)

    const moved = await taskBarBox(page, 'TASK-007')
    expect(moved.x).toBeGreaterThan(original.x)

    await resizeTask(page, 'TASK-007', 50)
    await expect(page.getByText('Новая длительность задачи применена.')).toBeVisible()
    expect(requests).toHaveLength(2)
    await expectChartUnlocked(page)
  })
})
