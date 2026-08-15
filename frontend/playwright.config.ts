import { defineConfig, devices } from '@playwright/test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendDirectory = dirname(fileURLToPath(import.meta.url))
const backendDirectory = resolve(frontendDirectory, '../backend')
const backendPython = process.platform === 'win32'
  ? '.\\.venv\\Scripts\\python.exe'
  : './.venv/bin/python'

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 6_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    video: 'off',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: `${backendPython} -m uvicorn app.main:app --host 127.0.0.1 --port 8000`,
      cwd: backendDirectory,
      url: 'http://127.0.0.1:8000/api/seed',
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 5173 --strictPort',
      cwd: frontendDirectory,
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
})
