import {
  dragTask,
  expect,
  expectChartUnlocked,
  placeTaskNearLeftEdge,
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
}

test('twenty-one-operation stress sequence survives repeated edge edits', async ({
  qaPage: page,
}) => {
  let operations = 0
  const completeOperation = async () => {
    operations += 1
    await expectStableAfterOperation(page)
  }

  // 1–2: gesture intent remains distinct for unchanged drag and resize.
  await dragTask(page, 'TASK-001', 4)
  await completeOperation()

  await resizeTask(page, 'TASK-001', 2)
  await completeOperation()

  // 3–5: normal changes and validation failure all clean up.
  await dragTask(page, 'TASK-007', 50)
  await expect(page.getByText('Новая дата задачи применена.')).toBeVisible()
  await completeOperation()

  await resizeTask(page, 'TASK-007', 50)
  await expect(page.getByText('Новая длительность задачи применена.')).toBeVisible()
  await completeOperation()

  await dragTask(page, 'TASK-006', -150)
  await expect(page.getByRole('alert')).toContainText('не может начинаться раньше')
  await completeOperation()

  // 6–7: an impacted preview can be cancelled and applied consecutively.
  await dragTask(page, 'TASK-005', 50)
  await expect(page.getByRole('heading', {
    name: 'Изменения ещё не применены',
  })).toBeVisible()
  await page.getByRole('button', { name: 'Отменить' }).click()
  await completeOperation()

  await dragTask(page, 'TASK-005', 50)
  await expect(page.getByRole('heading', {
    name: 'Изменения ещё не применены',
  })).toBeVisible()
  await page.getByRole('button', { name: 'Применить всё' }).click()
  await expect(page.getByRole('heading', {
    name: 'Изменения ещё не применены',
  })).toHaveCount(0)
  await completeOperation()

  // 8–11: the reproduced far-edge preview path supports Cancel, Apply,
  // and immediate follow-up drag/resize.
  await placeTaskNearLeftEdge(page, 'TASK-006')
  await dragTask(page, 'TASK-006', 280)
  await expect(page.getByRole('heading', {
    name: 'Изменения ещё не применены',
  })).toBeVisible()
  await page.getByRole('button', { name: 'Отменить' }).click()
  await completeOperation()

  await placeTaskNearLeftEdge(page, 'TASK-006')
  await dragTask(page, 'TASK-006', 280)
  await expect(page.getByRole('heading', {
    name: 'Изменения ещё не применены',
  })).toBeVisible()
  await page.getByRole('button', { name: 'Применить всё' }).click()
  await completeOperation()

  await placeTaskNearLeftEdge(page, 'TASK-007')
  await dragTask(page, 'TASK-007', 20)
  await expect(page.getByText('Новая дата задачи применена.')).toBeVisible()
  await completeOperation()

  await placeTaskNearLeftEdge(page, 'TASK-007')
  await resizeTask(page, 'TASK-007', 20)
  await expect(page.getByText('Новая длительность задачи применена.')).toBeVisible()
  await completeOperation()

  // 12–15: both project edges can be crossed by drag and resize.
  await placeTaskNearLeftEdge(page, 'TASK-001')
  await dragTask(page, 'TASK-001', -180)
  await expect(page.getByText('Новая дата задачи применена.')).toBeVisible()
  await completeOperation()

  await placeTaskNearLeftEdge(page, 'TASK-001')
  await resizeTask(page, 'TASK-001', 100)
  await expect(page.getByText('Новая длительность задачи применена.')).toBeVisible()
  await completeOperation()

  await placeTaskNearLeftEdge(page, 'TASK-007')
  await dragTask(page, 'TASK-007', 300)
  await expect(page.getByText('Новая дата задачи применена.')).toBeVisible()
  await completeOperation()

  await placeTaskNearLeftEdge(page, 'TASK-007')
  await resizeTask(page, 'TASK-007', 300)
  await expect(page.getByText('Новая длительность задачи применена.')).toBeVisible()
  await completeOperation()
  const farResizeGeometry = await page.locator('.gantt-host').evaluate((host) => {
    const gridWidth = Number(
      host.querySelector('.grid-row')?.getAttribute('width'),
    )
    const barEnds = [...host.querySelectorAll<SVGRectElement>(
      '.bar-wrapper .bar',
    )].map((bar) => (
      Number(bar.getAttribute('x')) + Number(bar.getAttribute('width'))
    ))
    return { gridWidth, maximumBarEnd: Math.max(...barEnds) }
  })
  expect(farResizeGeometry.gridWidth).toBeGreaterThanOrEqual(
    farResizeGeometry.maximumBarEnd,
  )

  await restoreDemo(page)

  // 16–21: repeat both deterministic paths after full state restoration.
  await placeTaskNearLeftEdge(page, 'TASK-007')
  await dragTask(page, 'TASK-007', 50)
  await expect(page.getByText('Новая дата задачи применена.')).toBeVisible()
  await completeOperation()

  await placeTaskNearLeftEdge(page, 'TASK-007')
  await resizeTask(page, 'TASK-007', 50)
  await expect(page.getByText('Новая длительность задачи применена.')).toBeVisible()
  await completeOperation()

  await dragTask(page, 'TASK-005', 50)
  await expect(page.getByRole('heading', {
    name: 'Изменения ещё не применены',
  })).toBeVisible()
  await page.getByRole('button', { name: 'Отменить' }).click()
  await completeOperation()

  await dragTask(page, 'TASK-005', 50)
  await expect(page.getByRole('heading', {
    name: 'Изменения ещё не применены',
  })).toBeVisible()
  await page.getByRole('button', { name: 'Применить всё' }).click()
  await completeOperation()

  await placeTaskNearLeftEdge(page, 'TASK-006')
  await dragTask(page, 'TASK-006', 280)
  await expect(page.getByRole('heading', {
    name: 'Изменения ещё не применены',
  })).toBeVisible()
  await page.getByRole('button', { name: 'Отменить' }).click()
  await completeOperation()

  await placeTaskNearLeftEdge(page, 'TASK-006')
  await dragTask(page, 'TASK-006', 280)
  await expect(page.getByRole('heading', {
    name: 'Изменения ещё не применены',
  })).toBeVisible()
  await page.getByRole('button', { name: 'Применить всё' }).click()
  await completeOperation()

  expect(operations).toBe(21)
})
