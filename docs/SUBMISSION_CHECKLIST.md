# Submission Checklist

Статусы:

- **READY** — требование имеет конкретное repository/deployment evidence.
- **HUMAN PENDING** — требуется только финальная запись настоящего production
  demo; функциональность при этом уже проверена.

| Исходное требование | Статус | Evidence |
| --- | --- | --- |
| Seeded interactive Gantt сразу после открытия | READY | Production [demo](https://bbaqdcimsde8vli202gq.containers.yandexcloud.net/), [`GanttChart.tsx`](../frontend/src/components/GanttChart.tsx), fixed [`seed/data.py`](../backend/app/seed/data.py) |
| Excel upload | READY | [`ImportDialog.tsx`](../frontend/src/components/ImportDialog.tsx), `POST /api/import` в [`planning.py`](../backend/app/api/planning.py), real-workbook Playwright coverage в [`state-excel.spec.ts`](../frontend/e2e/state-excel.spec.ts) |
| Adjacent AI chat | READY | [`AiDrawer.tsx`](../frontend/src/components/AiDrawer.tsx), `POST /api/chat` в [`chat.py`](../backend/app/api/chat.py) |
| Mass task moves | READY | MCP `move_tasks` в [`server.py`](../backend/app/mcp/server.py), orchestration tests в [`test_chat.py`](../backend/tests/test_chat.py) |
| Dependency changes | READY | MCP add/remove/replace predecessor tools в [`server.py`](../backend/app/mcp/server.py), deterministic graph в [`graph.py`](../backend/app/domain/graph.py) |
| Task creation | READY | MCP `create_task`, deterministic TASK-ID и placement в [`server.py`](../backend/app/mcp/server.py) и [`ids.py`](../backend/app/domain/ids.py) |
| Assignee redistribution | READY | MCP `set_assignee` в [`server.py`](../backend/app/mcp/server.py) |
| Immediate Gantt reflection / preview + Apply | READY | [`PendingPanel.tsx`](../frontend/src/components/PendingPanel.tsx), [`gantt-preview-overlay.ts`](../frontend/src/gantt-preview-overlay.ts), apply endpoint в [`planning.py`](../backend/app/api/planning.py) |
| Task modal | READY | Read-only [`TaskModal.tsx`](../frontend/src/components/TaskModal.tsx) |
| Excel export | READY | [`excel_export.py`](../backend/app/services/excel_export.py), `POST /api/export` и round-trip Playwright test в [`state-excel.spec.ts`](../frontend/e2e/state-excel.spec.ts) |
| React frontend | READY | [`frontend/package.json`](../frontend/package.json), [`App.tsx`](../frontend/src/App.tsx) |
| Python/FastAPI backend | READY | [`backend/pyproject.toml`](../backend/pyproject.toml), [`main.py`](../backend/app/main.py) |
| Реальный MCP | READY | Official client/server boundary в [`mcp/client.py`](../backend/app/mcp/client.py) и [`mcp/server.py`](../backend/app/mcp/server.py); не декоративный direct-call wrapper |
| LLM через API | READY | Qwen/OpenAI-compatible adapter в [`qwen.py`](../backend/app/ai/qwen.py); production live request принят Human QA |
| Required Excel columns | READY | Deterministic parser в [`excel_import.py`](../backend/app/services/excel_import.py), committed [`sample_tasks.xlsx`](../sample/sample_tasks.xlsx) |
| Git repository | READY | Versioned source, tests, docs и delivery automation в текущем repository |
| Deployed application | READY | Public unauthenticated [production URL](https://bbaqdcimsde8vli202gq.containers.yandexcloud.net/) |
| README и local run | READY | Reviewer-first [`README.md`](../README.md) |
| Architecture и решения | READY | [`ARCHITECTURE.md`](ARCHITECTURE.md), approved [`Master Brief`](AI_Gantt_Planner_Master_Brief_v1.3.md) |
| AI-assistant usage disclosure | READY | Раздел «Использование AI-ассистентов» в [`README.md`](../README.md#использование-ai-ассистентов-при-разработке) |
| Demo Excel upload → chat edit → export | **HUMAN PENDING** | Production recording script и final media slot в [`demo/README.md`](demo/README.md); media ещё не записано |
| Sample Excel | READY | [`sample/sample_tasks.xlsx`](../sample/sample_tasks.xlsx), packaging regression проверяет настоящий Replace import |
| Roadmap to Production | READY | [`ROADMAP_TO_PRODUCTION.md`](ROADMAP_TO_PRODUCTION.md) |

## Final Human submission actions

1. Записать real-provider production demo по
   [`docs/demo/README.md`](demo/README.md).
2. Добавить `docs/demo/ai-gantt-demo.mp4` и убедиться, что ссылка/файл открывается
   после fresh clone.
3. Перед отправкой проверить доступность production URL и выбрать commit,
   содержащий media artifact.

Все остальные пункты имеют repository или deployed-product evidence. Production
не требует reviewer IAM authentication.
