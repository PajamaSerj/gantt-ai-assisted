# AI Gantt Planner

AI Gantt Planner — интерактивный планировщик проекта: пользователь загружает
задачи из Excel, просматривает их на диаграмме Гантта и меняет план через
AI-помощника на естественном языке. Формальные решения о датах, зависимостях и
целостности плана всегда принимает детерминированный backend.

**Production demo:**
[https://bbaqdcimsde8vli202gq.containers.yandexcloud.net/](https://bbaqdcimsde8vli202gq.containers.yandexcloud.net/)

Основные возможности:

- готовый демонстрационный план сразу после открытия;
- интерактивный Gantt с deterministic drag/resize и Apply/Cancel для impact
  preview;
- Replace/Append импорт `.xlsx` и экспорт актуального плана в Excel;
- AI-команды для массового переноса, зависимостей, создания задач и назначения
  исполнителей;
- транзитивный impact preview до применения затрагивающих другие задачи
  изменений;
- read-only карточка задачи и сохранение состояния в браузере.

Стек: React, TypeScript, Vite, Frappe Gantt, Python, FastAPI, официальный MCP
Python SDK, OpenAI-compatible Responses API и Qwen в Yandex AI Studio. Единый
production image работает в Yandex Serverless Containers.

Материалы для проверки:

- [sample Excel](sample/sample_tasks.xlsx);
- [сценарий и слот demo-записи](docs/demo/README.md);
- [архитектура](docs/ARCHITECTURE.md);
- [Roadmap to Production](docs/ROADMAP_TO_PRODUCTION.md);
- [матрица требований](docs/SUBMISSION_CHECKLIST.md).

## Локальный запуск

Требования: Python 3.12+, Node.js 20.19+ и npm. Для AI-запросов также нужна
локальная конфигурация Yandex AI Studio; без неё все детерминированные функции
планировщика остаются доступны.

Backend:

```powershell
cd backend
python -m venv .venv
.venv\Scripts\python -m pip install -e ".[dev]"
.venv\Scripts\python -m uvicorn app.main:app --reload --env-file ..\.env
```

Frontend во втором терминале:

```powershell
cd frontend
npm install
npm run dev
```

Откройте `http://127.0.0.1:5173`. Vite проксирует `/api` на FastAPI по адресу
`http://127.0.0.1:8000`.

Для live AI скопируйте `.env.example` в локальный `.env` и заполните значения:

```text
YANDEX_CLOUD_API_KEY=<service-account API key>
YANDEX_CLOUD_FOLDER_ID=<AI Studio folder ID>
AI_MODEL=gpt://<folder ID>/qwen3.6-35b-a3b
AI_BASE_URL=https://ai.api.cloud.yandex.net/v1
```

`.env` игнорируется Git. API key используется только backend-процессом и не
попадает во frontend, `localStorage` или Docker build arguments.

## Проверки

```powershell
cd backend
.venv\Scripts\python -m pytest

cd ..\frontend
npm test
npm run lint
npm run build
npm run test:e2e
```

Автоматический QA охватывает domain/scheduling/ChangeSet, Excel, MCP и AI
orchestration contracts, frontend integration, recovery после drag/resize и
Playwright-сценарии в Chromium. Финальный packaging gate: 165 backend tests,
93 frontend tests и 23 Playwright tests; lint, production build, dependency
checks, Docker smoke и unauthenticated cloud smoke также прошли. Отдельно
выполнены Human QA production URL, реального Qwen-запроса, Excel Replace,
preview Apply/Cancel, экспорта и browser persistence. Подробности автономного
браузерного цикла находятся в
[`docs/qa/ITERATION_04_6_AUTONOMOUS_QA_REPORT.md`](docs/qa/ITERATION_04_6_AUTONOMOUS_QA_REPORT.md).

## Архитектура и ключевые решения

Browser хранит текущий `PlanState` в `localStorage` и отправляет его stateless
FastAPI backend. FastAPI обслуживает UI и `/api` из одного origin в production.
Полная схема и границы компонентов описаны в
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

Ключевые решения MVP:

- понедельник–пятница — рабочие дни; праздники не учитываются;
- поддерживается только Finish-to-Start dependency;
- неизвестные predecessor, self-reference и циклы отклоняются;
- batch проверяется как единый proposed final `PlanState`;
- вызванные изменения других задач показываются до применения;
- pending ChangeSet блокирует другие мутации до Apply, Cancel или Restore;
- backend stateless, постоянного server-side storage в MVP нет;
- Frappe Gantt — visualization layer, а не источник scheduling logic.

### Детерминированный backend и LLM

| LLM отвечает за | Детерминированный backend отвечает за |
| --- | --- |
| понимание естественного языка | календарную арифметику и рабочие дни |
| выбор разрешённого инструмента | граф зависимостей, self-reference и циклы |
| сопоставление пользовательских сущностей | Excel parsing и валидацию |
| подготовку аргументов MCP tool | ChangeSet, atomicity и impact analysis |
| пояснения и уточняющие вопросы | re-validation и окончательное применение |

LLM не получает право самостоятельно выбирать даты, исправлять зависимости,
разбирать Excel или оптимизировать расписание. При неоднозначности он задаёт
уточняющий вопрос; при impact решение остаётся за пользователем.

### Реальное использование MCP

FastAPI создаёт request-scoped MCP context для переданного `PlanState`.
LLM вызывает опубликованные MCP tools через официальный client/server boundary:
read tools (`get_tasks`, `get_task`, `get_dependencies`) читают план, а prepare
tools формируют изменения. MCP tools не сохраняют состояние и не обходят
deterministic ChangeSet validation. Полный план не вкладывается в model prompt.

## Excel contract

Принимается только `.xlsx`; обрабатывается только active worksheet. Обязательные
колонки:

```text
задача
описание
исполнитель
длительность
предшественники
```

Заголовки нормализуются по регистру и пробелам. Неизвестные колонки и полностью
пустые строки игнорируются. Несколько predecessor разделяются `;`; поэтому этот
символ запрещён в названии задачи без escaping/quoting syntax.

Replace заменяет текущий план и детерминированно генерирует `TASK-001`,
`TASK-002`, ... в порядке строк. Append объединяет incoming/current task names,
сохраняет существующие ID и начинает новые ID после максимального `TASK-NNN`.
Import атомарен: при ошибке не применяется ничего.

Committed [`sample/sample_tasks.xlsx`](sample/sample_tasks.xlsx) содержит
параллельные ветки и задачу с двумя predecessor. Packaging regression отправляет
этот файл в настоящий `POST /api/import` в Replace mode и применяет полученный
ChangeSet.

## Production container и deployment

Root `Dockerfile` собирает React через Vite, устанавливает Python runtime
dependencies и запускает FastAPI/Uvicorn от non-root пользователя. Локальный
production build:

```powershell
docker build --platform linux/amd64 --provenance=false --sbom=false `
  --tag ai-gantt-planner:local .
docker run --rm --publish 8080:8080 --env PORT=8080 ai-gantt-planner:local
```

Откройте `http://127.0.0.1:8080`. Повторяемый smoke:

```powershell
pwsh -File .\infra\docker\smoke.ps1
```

Delivery flow: immutable Git-SHA image → Yandex Container Registry → Yandex
Serverless Containers. Runtime credential передаётся из Yandex Lockbox только в
environment контейнера. Automation имеет read-only plan по умолчанию; подробная
инструкция находится в [`infra/yandex/README.md`](infra/yandex/README.md).

## Известные ограничения MVP

- plan и conversation context хранятся только в `localStorage` конкретного
  браузера;
- нет пользователей, authentication, workspaces, history и concurrency control;
- нет holiday calendars, milestones, resource capacity или SS/FF/SF dependencies;
- task modal только для чтения;
- re-import экспортированного файла пересоздаёт TASK-ID и расписание по обычному
  import contract;
- public demo не имеет reviewer authentication и не предназначен для хранения
  конфиденциальных планов;
- нет автоматического multi-provider fallback, production observability и
  cost/rate controls уровня промышленной системы.

Это осознанный technical debt MVP, а не скрытые production guarantees. Порядок
закрытия описан в
[`docs/ROADMAP_TO_PRODUCTION.md`](docs/ROADMAP_TO_PRODUCTION.md).

## Использование AI-ассистентов при разработке

AI-ассистенты использовались для реализации отдельных компонентов, scaffolding,
code review, тестов и документации. Архитектура, бизнес-правила, системная модель
и границы MVP были определены и зафиксированы до основной реализации.

Финальное поведение проверено автоматическими unit/integration/E2E тестами и
Human QA, включая production deployment с настоящим Qwen provider. Проект не
позиционируется как автономно сгенерированный AI без инженерного контроля.
