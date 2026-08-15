import { dragTask, expect, test } from './qa-fixtures'

const viewports = [
  { name: 'primary desktop', width: 1440, height: 900 },
  { name: 'wide desktop', width: 1920, height: 1080 },
  { name: 'compact desktop', width: 1024, height: 768 },
] as const

for (const viewport of viewports) {
  test.describe(`${viewport.name} ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport })

    test('baseline, scales and AI drawer keep the canvas usable', async ({
      qaPage: page,
    }) => {
      await expect(page.locator('.bar-wrapper')).toHaveCount(7)
      await expect.poll(async () => page.locator('.bar-wrapper .bar').evaluateAll(
        (bars) => new Set(bars.map((bar) => bar.getAttribute('y'))).size,
      )).toBe(7)
      await expect(page.getByText('Исследование продукта', { exact: false })).toBeVisible()
      await expect(page.locator('body')).not.toContainText(
        /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}/i,
      )

      const baseline = await page.locator('.gantt-host').evaluate((host) => {
        const svg = host.querySelector<SVGSVGElement>('svg.gantt')
        const bars = [...host.querySelectorAll<SVGRectElement>(
          '.bar-wrapper .bar',
        )]
        const ends = bars.map(
          (bar) => Number(bar.getAttribute('x')) + Number(bar.getAttribute('width')),
        )
        return {
          viewportWidth: innerWidth,
          pageScrollWidth: document.documentElement.scrollWidth,
          clientWidth: host.querySelector<HTMLElement>('.gantt-container')?.clientWidth ?? 0,
          scrollWidth: host.querySelector<HTMLElement>('.gantt-container')?.scrollWidth ?? 0,
          svgWidth: svg?.getBoundingClientRect().width ?? 0,
          minStart: Math.min(...bars.map((bar) => Number(bar.getAttribute('x')))),
          maxEnd: Math.max(...ends),
          positiveBars: bars.every((bar) => Number(bar.getAttribute('width')) > 0),
        }
      })
      expect(baseline.pageScrollWidth).toBeLessThanOrEqual(
        baseline.viewportWidth + 1,
      )
      expect(baseline.positiveBars).toBe(true)
      expect(baseline.minStart).toBeGreaterThan(0)
      expect(baseline.svgWidth - baseline.maxEnd).toBeGreaterThan(0)
      expect(baseline.scrollWidth).toBeGreaterThanOrEqual(baseline.clientWidth)
      expect(baseline.svgWidth).toBeGreaterThanOrEqual(baseline.clientWidth - 1)

      const scale = page.getByLabel('Масштаб')
      for (const mode of ['Day', 'Month', 'Week']) {
        await scale.selectOption(mode)
        await expect(page.locator('.bar-wrapper')).toHaveCount(7)
        await expect.poll(async () => page.locator('.bar-wrapper .bar').evaluateAll(
          (bars) => bars.every(
            (bar) => Number(bar.getAttribute('width')) > 0,
          ),
        )).toBe(true)
      }

      await page.getByRole('button', { name: 'AI-помощник' }).click()
      await expect(page.getByRole('complementary', {
        name: 'AI-помощник',
      })).toBeVisible()
      await expect(page.locator('.bar-wrapper')).toHaveCount(7)
      const drawerLayout = await page.locator('.workspace-layout').evaluate(
        (layout) => ({
          right: layout.getBoundingClientRect().right,
          viewport: innerWidth,
          pageScrollWidth: document.documentElement.scrollWidth,
        }),
      )
      expect(drawerLayout.right).toBeLessThanOrEqual(drawerLayout.viewport + 1)
      expect(drawerLayout.pageScrollWidth).toBeLessThanOrEqual(
        drawerLayout.viewport + 1,
      )
      await page.getByRole('button', {
        name: 'Закрыть AI-помощника',
      }).click()
      await expect(page.getByRole('complementary', {
        name: 'AI-помощник',
      })).toHaveCount(0)

      const controls = await page.locator('.toolbar').evaluate((toolbar) => {
        const brand = toolbar.querySelector('.brand-lockup')?.getBoundingClientRect()
        const actions = toolbar.querySelector('.toolbar-actions')?.getBoundingClientRect()
        return {
          separated: Boolean(brand && actions && brand.right <= actions.left),
          actionsInside: Boolean(actions && actions.right <= innerWidth),
        }
      })
      expect(controls).toEqual({ separated: true, actionsInside: true })
    })
  })
}

test.describe('preview SVG geometry', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('labels, connectors and outlines remain on the existing rows', async ({
    qaPage: page,
  }) => {
    await dragTask(page, 'TASK-005', 150)
    await expect(page.getByRole('heading', {
      name: 'Изменения ещё не применены',
    })).toBeVisible()

    const geometry = await page.locator('.gantt-preview-item').evaluateAll(
      (items) => items.map((item) => {
        const taskId = item.getAttribute('data-task-id')
        const timelineWidth = document.querySelector<SVGGraphicsElement>(
          '.grid-row',
        )?.getBoundingClientRect().width ?? 0
        const current = document.querySelector<SVGGraphicsElement>(
          `.bar-wrapper[data-id="${taskId}"] .bar`,
        )
        const proposed = item.querySelector<SVGGraphicsElement>(
          '.gantt-preview-proposed-bar',
        )
        const label = item.querySelector<SVGGraphicsElement>(
          '.gantt-preview-safe-label',
        )
        const connector = item.querySelector<SVGLineElement>(
          '.gantt-preview-connector',
        )
        const currentRect = current?.getBoundingClientRect()
        const labelRect = label?.getBoundingClientRect()
        const proposedX = Number(proposed?.getAttribute('x'))
        const proposedWidth = Number(proposed?.getAttribute('width'))
        const currentX = Number(current?.getAttribute('x'))
        const currentWidth = Number(current?.getAttribute('width'))
        const direction = item.getAttribute('data-direction')
        const connectorX1 = Number(connector?.getAttribute('x1'))
        const connectorX2 = Number(connector?.getAttribute('x2'))
        return {
          taskId,
          sameRow: item.getAttribute('data-current-y') ===
            item.getAttribute('data-proposed-y'),
          proposedInsideSvg: proposedX >= 0 &&
            proposedX + proposedWidth <= timelineWidth,
          labelInside: !label || Boolean(
            currentRect && labelRect &&
            labelRect.left >= currentRect.left - 0.5 &&
            labelRect.right <= currentRect.right + 0.5,
          ),
          labelMode: label?.getAttribute('data-label-mode') ??
            item.getAttribute('data-label-mode'),
          connectorOutside: !connector || (
            direction === 'right'
              ? connectorX1 >= currentX + currentWidth &&
                connectorX2 <= proposedX
              : connectorX1 <= currentX &&
                connectorX2 >= proposedX + proposedWidth
          ),
          labelTopmost: !label || item.lastElementChild === label,
        }
      }),
    )

    expect(geometry).toHaveLength(3)
    expect(geometry.every((item) => item.sameRow)).toBe(true)
    expect(geometry.every((item) => item.proposedInsideSvg)).toBe(true)
    expect(geometry.every((item) => item.labelInside)).toBe(true)
    expect(geometry.every((item) => item.connectorOutside)).toBe(true)
    expect(geometry.every((item) => item.labelTopmost)).toBe(true)
    expect(geometry.some((item) => item.labelMode === 'number')).toBe(true)
    await expect(page.locator(
      '.gantt-preview-overlay text:not(.gantt-preview-safe-label)',
    )).toHaveCount(0)
    await expect(page.locator('.gantt-preview-proposed-direct')).toHaveCount(1)
    await expect(page.locator('.gantt-preview-proposed-dependency')).toHaveCount(2)
    await expect(page.locator('.bar-wrapper')).toHaveCount(7)
    await expect.poll(async () => page.locator('.bar-wrapper .bar').evaluateAll(
      (bars) => new Set(bars.map((bar) => bar.getAttribute('y'))).size,
    )).toBe(7)

    await page.getByRole('button', { name: 'Отменить' }).click()
    await expect(page.locator('.gantt-preview-overlay')).toHaveCount(0)
    await expect(page.locator('.gantt-preview-frappe-label-hidden')).toHaveCount(0)
    await expect(page.locator('.gantt-preview-task-title')).toHaveCount(0)
    await expect(page.locator('.gantt-preview-current-label-clip')).toHaveCount(0)
  })
})
