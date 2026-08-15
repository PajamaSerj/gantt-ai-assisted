import {
  directEditRequests,
  dragTask,
  expect,
  expectChartUnlocked,
  test,
} from './qa-fixtures'

test.describe('invalid, cancelled and interrupted gesture recovery', () => {
  test('dependency-bound drag restores geometry and allows the next valid edit', async ({
    qaPage: page,
  }) => {
    const requests = directEditRequests(page)
    const originalX = await page.locator(
      '.bar-wrapper[data-id="TASK-006"] .bar',
    ).getAttribute('x')

    await dragTask(page, 'TASK-006', -150)
    await expect(page.getByRole('alert')).toContainText(
      'не может начинаться раньше',
    )
    await expect(page.getByRole('heading', {
      name: 'Изменения ещё не применены',
    })).toHaveCount(0)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator(
      '.bar-wrapper[data-id="TASK-006"] .bar',
    )).toHaveAttribute('x', originalX ?? '')
    await expectChartUnlocked(page)

    await dragTask(page, 'TASK-007', 50)
    await expect(page.getByText('Новая дата задачи применена.')).toBeVisible()
    expect(requests).toHaveLength(2)
    await expectChartUnlocked(page)
  })

  test('Cancel removes preview state and immediately restores interaction', async ({
    qaPage: page,
  }) => {
    const originalX = await page.locator(
      '.bar-wrapper[data-id="TASK-005"] .bar',
    ).getAttribute('x')
    await dragTask(page, 'TASK-005', 50)
    await expect(page.getByRole('heading', {
      name: 'Изменения ещё не применены',
    })).toBeVisible()

    await page.getByRole('button', { name: 'Отменить' }).click()
    await expect(page.locator('.gantt-preview-overlay')).toHaveCount(0)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator(
      '.bar-wrapper[data-id="TASK-005"] .bar',
    )).toHaveAttribute('x', originalX ?? '')
    await expectChartUnlocked(page)

    await page.locator('.bar-wrapper[data-id="TASK-005"] .bar').click()
    await expect(page.getByRole('dialog', {
      name: 'Интеграция приложения',
    })).toBeVisible()
  })

  test('pointer cancel, lost capture and request failure do not stick the chart', async ({
    qaPage: page,
    allowedApiFailures,
  }) => {
    const bar = page.locator('.bar-wrapper[data-id="TASK-001"] .bar')
    await bar.dispatchEvent('pointerdown', {
      pointerId: 21,
      button: 0,
      isPrimary: true,
      clientX: 100,
      clientY: 100,
    })
    await bar.dispatchEvent('pointermove', {
      pointerId: 21,
      isPrimary: true,
      clientX: 112,
      clientY: 100,
    })
    await bar.dispatchEvent('pointercancel', {
      pointerId: 21,
      isPrimary: true,
      clientX: 112,
      clientY: 100,
    })
    await expectChartUnlocked(page)

    await bar.dispatchEvent('pointerdown', {
      pointerId: 22,
      button: 0,
      isPrimary: true,
      clientX: 100,
      clientY: 100,
    })
    await bar.dispatchEvent('pointermove', {
      pointerId: 22,
      isPrimary: true,
      clientX: 112,
      clientY: 100,
    })
    await bar.dispatchEvent('lostpointercapture', {
      pointerId: 22,
      isPrimary: true,
    })
    await page.locator('body').dispatchEvent('pointerup', {
      pointerId: 22,
      button: 0,
      isPrimary: true,
      clientX: 1400,
      clientY: 100,
    })
    await expectChartUnlocked(page)

    allowedApiFailures.add('/api/direct-edits/prepare')
    await page.route('**/api/direct-edits/prepare', (route) => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'QA forced direct-edit failure' }),
    }))
    await dragTask(page, 'TASK-007', 50)
    await expect(page.getByRole('alert')).toContainText(
      'QA forced direct-edit failure',
    )
    await expectChartUnlocked(page)

    await page.unroute('**/api/direct-edits/prepare')
    allowedApiFailures.clear()
    await dragTask(page, 'TASK-007', 50)
    await expect(page.getByText('Новая дата задачи применена.')).toBeVisible()
    await expectChartUnlocked(page)
  })

  test('timeline-edge attempts and reconstruction preserve normal manipulation', async ({
    qaPage: page,
  }) => {
    const scroller = page.locator('.gantt-container')
    await scroller.evaluate((element) => {
      element.scrollLeft = 0
    })
    await dragTask(page, 'TASK-001', -180)
    await expect(page.getByText('Новая дата задачи применена.')).toBeVisible()
    await expectChartUnlocked(page)

    await scroller.evaluate((element) => {
      element.scrollLeft = element.scrollWidth
    })
    await dragTask(page, 'TASK-007', 300)
    await expect(page.getByText('Новая дата задачи применена.')).toBeVisible()
    await expectChartUnlocked(page)

    await page.getByLabel('Масштаб').selectOption('Month')
    await expect(page.locator('.bar-wrapper')).toHaveCount(7)
    await page.getByLabel('Масштаб').selectOption('Week')
    await expect(page.locator('.bar-wrapper')).toHaveCount(7)

    await dragTask(page, 'TASK-007', 50)
    await expect(page.getByText('Новая дата задачи применена.')).toBeVisible()
    await expectChartUnlocked(page)
    const scrollState = await scroller.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      scrollLeft: element.scrollLeft,
    }))
    expect(scrollState.scrollWidth).toBeGreaterThan(scrollState.clientWidth)
    expect(scrollState.scrollLeft).toBeGreaterThanOrEqual(0)
  })
})
