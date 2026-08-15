import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, expectChartUnlocked, test } from './qa-fixtures'

const currentDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(currentDirectory, '../..')
const backendPython = process.platform === 'win32'
  ? resolve(repositoryRoot, 'backend/.venv/Scripts/python.exe')
  : resolve(repositoryRoot, 'backend/.venv/bin/python')
const workbookBuilder = resolve(currentDirectory, 'workbook-fixtures.py')
const requiredHeaders = [
  'задача',
  'описание',
  'исполнитель',
  'длительность',
  'предшественники',
]

function workbookPath(
  outputPath: (name: string) => string,
  name: string,
  rows: unknown[][],
) {
  const path = outputPath(name)
  execFileSync(backendPython, [
    workbookBuilder,
    path,
    JSON.stringify({ headers: requiredHeaders, rows }),
  ])
  return path
}

async function submitWorkbook(
  page: import('@playwright/test').Page,
  path: string,
  mode: 'Заменить' | 'Дополнить',
) {
  await page.getByRole('button', { name: 'Excel', exact: true }).click()
  await page.getByLabel('Выбрать Excel для импорта').setInputFiles(path)
  await expect(page.getByRole('dialog', {
    name: 'Импортировать Excel',
  })).toBeVisible()
  await page.getByLabel(mode).check()
  const dateField = mode === 'Заменить'
    ? page.getByLabel('Дата начала плана')
    : page.getByLabel('Не раньше какой даты начинать новые задачи?')
  await dateField.fill('2026-02-02')
  await page.getByRole('button', {
    name: 'Проверить и импортировать',
  }).click()
}

test('valid self-contained Replace workbook still imports', async ({
  qaPage: page,
}, testInfo) => {
  const path = workbookPath(testInfo.outputPath.bind(testInfo), 'replace.xlsx', [
    ['Планирование релиза', null, 'Анна', 2, null],
    ['Подготовка материалов', null, 'Борис', 1, null],
  ])

  await submitWorkbook(page, path, 'Заменить')

  await expect(page.getByText('Excel успешно импортирован.')).toBeVisible()
  await expect(page.locator('.bar-wrapper')).toHaveCount(2)
})

test('valid Append workbook can reference the demo plan', async ({
  qaPage: page,
}, testInfo) => {
  const path = workbookPath(testInfo.outputPath.bind(testInfo), 'append.xlsx', [
    ['Публикация отчёта', null, 'Анна', 1, 'Подготовка демо'],
  ])

  await submitWorkbook(page, path, 'Дополнить')

  await expect(page.getByRole('heading', {
    name: 'Изменения ещё не применены',
  })).toBeVisible()
  await page.getByRole('button', { name: 'Применить всё' }).click()
  await expect(page.locator('.bar-wrapper')).toHaveCount(8)
  await expect(page.locator('.gantt-host')).toHaveClass(/gantt-interactive/)
  await expect(page.locator('.gantt-host')).not.toHaveClass(
    /gantt-direct-edit-busy|gantt-interaction-disabled/,
  )
  await expect(page.locator('.handle.right')).toHaveCount(8)
})

test('Replace explains both unresolved Append predecessors in Russian', async ({
  qaPage: page,
}, testInfo) => {
  const path = workbookPath(
    testInfo.outputPath.bind(testInfo),
    'append-oriented.xlsx',
    [[
      'Публикация релиза',
      null,
      'Анна',
      1,
      'Интеграция приложения; Сквозное тестирование',
    ]],
  )

  await submitWorkbook(page, path, 'Заменить')

  const panel = page.getByRole('region', { name: 'Исправьте ошибки в Excel' })
  await expect(panel).toBeVisible()
  await expect(panel).toContainText(
    'Предшественник «Интеграция приложения» не найден. В режиме замены',
  )
  await expect(panel).toContainText(
    'Предшественник «Сквозное тестирование» не найден. В режиме замены',
  )
  await expect(panel).not.toContainText('Unknown predecessor')
  await expect(page.locator('.bar-wrapper')).toHaveCount(7)
  await expectChartUnlocked(page)
})

test('row-level Excel validation is fully localized', async ({
  qaPage: page,
}, testInfo) => {
  const path = workbookPath(testInfo.outputPath.bind(testInfo), 'invalid-row.xlsx', [
    [null, null, null, 'two', 42],
  ])

  await submitWorkbook(page, path, 'Заменить')

  const panel = page.getByRole('region', { name: 'Исправьте ошибки в Excel' })
  await expect(panel).toContainText('Строка 2')
  await expect(panel).toContainText('Укажите название задачи.')
  await expect(panel).toContainText(
    'Длительность должна быть положительным целым числом рабочих дней.',
  )
  await expect(panel).toContainText(
    'Предшественники должны быть указаны названиями задач через «;».',
  )
  await expect(panel).not.toContainText(
    /Task name|Duration must|Predecessors must/,
  )
  await expect(page.locator('.bar-wrapper')).toHaveCount(7)
  await expectChartUnlocked(page)
})
