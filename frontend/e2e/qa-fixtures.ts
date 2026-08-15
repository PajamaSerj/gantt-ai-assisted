import {
  expect,
  test as base,
  type ConsoleMessage,
  type Page,
  type Request,
  type Response,
} from '@playwright/test'

type QaFixtures = {
  qaPage: Page
  qaProblems: string[]
  allowedApiFailures: Set<string>
}

function applicationPath(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.pathname.startsWith('/api/') ? parsed.pathname : null
  } catch {
    return null
  }
}

function isAllowed(path: string, allowlist: Set<string>): boolean {
  return [...allowlist].some((allowed) => path.startsWith(allowed))
}

export const test = base.extend<QaFixtures>({
  qaProblems: async ({ browserName: _browserName }, provide) => {
    await provide([])
  },
  allowedApiFailures: async ({ browserName: _browserName }, provide) => {
    await provide(new Set())
  },
  qaPage: async ({ page, qaProblems, allowedApiFailures }, provide) => {
    const onPageError = (error: Error) => {
      qaProblems.push(`pageerror: ${error.message}`)
    }
    const onConsole = (message: ConsoleMessage) => {
      if (message.type() === 'error') {
        if (
          allowedApiFailures.size > 0 &&
          message.text().startsWith('Failed to load resource:')
        ) return
        qaProblems.push(`console.error: ${message.text()}`)
      }
    }
    const onResponse = (response: Response) => {
      const path = applicationPath(response.url())
      if (
        path && response.status() >= 400 &&
        !isAllowed(path, allowedApiFailures)
      ) {
        qaProblems.push(`api ${response.status()}: ${path}`)
      }
    }
    const onRequestFailed = (request: Request) => {
      const path = applicationPath(request.url())
      const failure = request.failure()?.errorText ?? 'unknown failure'
      if (
        path && failure !== 'net::ERR_ABORTED' &&
        !isAllowed(path, allowedApiFailures)
      ) {
        qaProblems.push(`requestfailed: ${path} (${failure})`)
      }
    }

    page.on('pageerror', onPageError)
    page.on('console', onConsole)
    page.on('response', onResponse)
    page.on('requestfailed', onRequestFailed)

    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'План проекта' })).toBeVisible()
    await expect(page.locator('.bar-wrapper')).toHaveCount(7)

    await provide(page)

    expect(qaProblems, 'unexpected browser/runtime errors').toEqual([])
  },
})

export { expect } from '@playwright/test'

export async function taskBarBox(page: Page, taskPublicId: string) {
  const bar = page.locator(
    `.bar-wrapper[data-id="${taskPublicId}"] .bar`,
  )
  await expect(bar).toBeVisible()
  const box = await bar.boundingBox()
  if (!box) throw new Error(`Task bar ${taskPublicId} is not visible`)
  return box
}

export async function rightHandleBox(page: Page, taskPublicId: string) {
  const handle = page.locator(
    `.bar-wrapper[data-id="${taskPublicId}"] .handle.right`,
  )
  await expect(handle).toBeVisible()
  const box = await handle.boundingBox()
  if (!box) throw new Error(`Right handle ${taskPublicId} is not visible`)
  return box
}

async function dragFromBox(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
  deltaX: number,
  deltaY = 0,
) {
  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 8 })
  await page.mouse.up()
}

export async function dragTask(
  page: Page,
  taskPublicId: string,
  deltaX: number,
  deltaY = 0,
) {
  await dragFromBox(page, await taskBarBox(page, taskPublicId), deltaX, deltaY)
}

export async function resizeTask(
  page: Page,
  taskPublicId: string,
  deltaX: number,
) {
  await dragFromBox(page, await rightHandleBox(page, taskPublicId), deltaX)
}

export async function expectChartUnlocked(page: Page) {
  const host = page.locator('.gantt-host')
  await expect(host).toHaveClass(/gantt-interactive/)
  await expect(host).not.toHaveClass(/gantt-direct-edit-busy/)
  await expect(host).not.toHaveClass(/gantt-interaction-disabled/)
  await expect(page.locator('.bar-wrapper')).toHaveCount(7)
  await expect(page.locator('.handle.right')).toHaveCount(7)
  const blockedTargets = await page.locator('.bar-wrapper').evaluateAll(
    (wrappers) => wrappers.flatMap((wrapper) => {
      const taskId = wrapper.getAttribute('data-id') ?? 'unknown'
      const right = wrapper.querySelector('.handle.right')
      const blocked: string[] = []
      if (getComputedStyle(wrapper).pointerEvents === 'none') {
        blocked.push(`${taskId}:task`)
      }
      if (right && getComputedStyle(right).pointerEvents === 'none') {
        blocked.push(`${taskId}:right`)
      }
      return blocked
    }),
  )
  expect(blockedTargets).toEqual([])
}

export async function restoreDemo(page: Page) {
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: /Восстановить демо/ }).click()
  await expect(page.getByText('Демо-план восстановлен.')).toBeVisible()
  await expectChartUnlocked(page)
}

export function directEditRequests(page: Page) {
  const requests: Request[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/direct-edits/prepare') {
      requests.push(request)
    }
  })
  return requests
}
