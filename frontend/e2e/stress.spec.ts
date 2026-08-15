import {
  dragTask,
  expect,
  expectChartUnlocked,
  resizeTask,
  restoreDemo,
  test,
} from './qa-fixtures'

async function expectStableAfterOperation(page: Parameters<typeof dragTask>[0]) {
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('heading', {
    name: 'Изменения ещё не применены',
  })).toHaveCount(0)
  await expectChartUnlocked(page)
  await dragTask(page, 'TASK-001', 4)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expectChartUnlocked(page)
}

test('twelve-operation stress sequence never leaves Gantt interaction stuck', async ({
  qaPage: page,
}) => {
  let operations = 0

  await page.locator('.bar-wrapper[data-id="TASK-001"] .bar').click()
  await expect(page.getByRole('dialog', {
    name: 'Исследование продукта',
  })).toBeVisible()
  await page.getByRole('dialog').getByRole('button', {
    name: 'Закрыть',
  }).last().click()
  operations += 1
  await expectStableAfterOperation(page)

  await dragTask(page, 'TASK-001', 4)
  operations += 1
  await expectStableAfterOperation(page)

  await resizeTask(page, 'TASK-001', 2)
  operations += 1
  await expectStableAfterOperation(page)

  await dragTask(page, 'TASK-007', 50)
  await expect(page.getByText('Новая дата задачи применена.')).toBeVisible()
  operations += 1
  await expectStableAfterOperation(page)

  await resizeTask(page, 'TASK-007', 50)
  await expect(page.getByText('Новая длительность задачи применена.')).toBeVisible()
  operations += 1
  await expectStableAfterOperation(page)

  await dragTask(page, 'TASK-006', -150)
  await expect(page.getByRole('alert')).toContainText('не может начинаться раньше')
  operations += 1
  await expectStableAfterOperation(page)

  await dragTask(page, 'TASK-005', 50)
  await expect(page.getByRole('heading', {
    name: 'Изменения ещё не применены',
  })).toBeVisible()
  await page.getByRole('button', { name: 'Отменить' }).click()
  operations += 1
  await expectStableAfterOperation(page)

  await dragTask(page, 'TASK-005', 50)
  await expect(page.getByRole('heading', {
    name: 'Изменения ещё не применены',
  })).toBeVisible()
  await page.getByRole('button', { name: 'Применить всё' }).click()
  await expect(page.getByRole('heading', {
    name: 'Изменения ещё не применены',
  })).toHaveCount(0)
  operations += 1
  await expectStableAfterOperation(page)

  await page.getByLabel('Масштаб').selectOption('Day')
  operations += 1
  await expectStableAfterOperation(page)

  await page.getByLabel('Масштаб').selectOption('Week')
  operations += 1
  await expectStableAfterOperation(page)

  await page.getByRole('button', { name: 'AI-помощник' }).click()
  await expect(page.getByRole('complementary', {
    name: 'AI-помощник',
  })).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть AI-помощника' }).click()
  operations += 1
  await expectStableAfterOperation(page)

  await restoreDemo(page)
  operations += 1
  await expectStableAfterOperation(page)

  expect(operations).toBe(12)
})
