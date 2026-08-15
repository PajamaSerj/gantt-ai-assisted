import {
  dragTask,
  expect,
  expectChartUnlocked,
  placeTaskNearLeftEdge,
  test,
} from './qa-fixtures'

test.describe('captured far-edge live incident', () => {
  test.use({ viewport: { width: 454, height: 866 } })

  test('far impacted preview keeps proposed geometry over calendar rows', async ({
    qaPage: page,
  }) => {
    await placeTaskNearLeftEdge(page, 'TASK-006')
    await dragTask(page, 'TASK-006', 280)
    await expect(page.getByRole('heading', {
      name: 'Изменения ещё не применены',
    })).toBeVisible()

    const geometry = await page.locator('.gantt-host').evaluate((host) => {
      const gridWidth = Number(
        host.querySelector('.grid-row')?.getAttribute('width'),
      )
      const proposedEnds = [...host.querySelectorAll<SVGRectElement>(
        '.gantt-preview-proposed-bar',
      )].map((bar) => (
        Number(bar.getAttribute('x')) + Number(bar.getAttribute('width'))
      ))
      return {
        gridWidth,
        proposedCount: proposedEnds.length,
        proposedMaxEnd: Math.max(...proposedEnds),
      }
    })

    expect(geometry.proposedCount).toBe(2)
    expect(geometry.gridWidth).toBeGreaterThanOrEqual(geometry.proposedMaxEnd)
  })

  test('Apply after a far impacted drag restores drag and right resize', async ({
    qaPage: page,
  }) => {
    await placeTaskNearLeftEdge(page, 'TASK-006')
    await dragTask(page, 'TASK-006', 280)
    await expect(page.getByRole('heading', {
      name: 'Изменения ещё не применены',
    })).toBeVisible()

    await page.getByRole('button', { name: 'Применить всё' }).click()
    await expect(page.getByRole('heading', {
      name: 'Изменения ещё не применены',
    })).toHaveCount(0)
    await page.waitForTimeout(400)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expectChartUnlocked(page)

    await placeTaskNearLeftEdge(page, 'TASK-006')
    await page.locator('.bar-wrapper[data-id="TASK-006"] .bar').click()
    await expect(page.getByRole('dialog', {
      name: 'Сквозное тестирование',
    })).toBeVisible()
    await page.getByRole('dialog').getByRole('button', {
      name: 'Закрыть',
    }).last().click()

    await placeTaskNearLeftEdge(page, 'TASK-007')
    await dragTask(page, 'TASK-007', 20)
    await expect(page.getByText('Новая дата задачи применена.')).toBeVisible()
    await expectChartUnlocked(page)
  })

  test('pointer cancellation resets the underlying Frappe drag state', async ({
    qaPage: page,
  }) => {
    const task = page.locator('.bar-wrapper[data-id="TASK-001"] .bar')
    const svg = page.locator('svg.gantt')
    const originalX = Number(await task.getAttribute('x'))

    await task.dispatchEvent('pointerdown', {
      pointerId: 41,
      button: 0,
      isPrimary: true,
      clientX: 170,
      clientY: 350,
    })
    await task.dispatchEvent('mousedown', {
      button: 0,
      clientX: 170,
      clientY: 350,
    })
    await svg.dispatchEvent('mousemove', {
      clientX: 250,
      clientY: 350,
    })
    await task.dispatchEvent('pointercancel', {
      pointerId: 41,
      isPrimary: true,
      clientX: 250,
      clientY: 350,
    })
    await expect.poll(async () => Number(await page.locator(
      '.bar-wrapper[data-id="TASK-001"] .bar',
    ).getAttribute('x'))).toBe(originalX)

    await page.locator('svg.gantt').dispatchEvent('mousemove', {
      clientX: 330,
      clientY: 350,
    })
    await expect(page.locator(
      '.bar-wrapper[data-id="TASK-001"] .bar',
    )).toHaveAttribute('x', String(originalX))
    await page.locator('body').dispatchEvent('mouseup', { button: 0 })
    await expectChartUnlocked(page)
  })
})
