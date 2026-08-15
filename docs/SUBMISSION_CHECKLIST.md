# Матрица требований к сдаче

Статус **ГОТОВО** означает, что требование подтверждено файлами репозитория,
автоматическими/ручными проверками или развёрнутым приложением.

| Исходное требование | Статус | Подтверждение |
| --- | --- | --- |
| Интерактивная диаграмма с готовыми данными сразу после открытия | ГОТОВО | Развёрнутое [приложение](https://bbaqdcimsde8vli202gq.containers.yandexcloud.net/), [`GanttChart.tsx`](../frontend/src/components/GanttChart.tsx), фиксированные данные в [`seed/data.py`](../backend/app/seed/data.py) |
| Загрузка Excel | ГОТОВО | [`ImportDialog.tsx`](../frontend/src/components/ImportDialog.tsx), `POST /api/import` в [`planning.py`](../backend/app/api/planning.py), Playwright-проверка с настоящим файлом в [`state-excel.spec.ts`](../frontend/e2e/state-excel.spec.ts) |
| AI-чат рядом с диаграммой | ГОТОВО | [`AiDrawer.tsx`](../frontend/src/components/AiDrawer.tsx), `POST /api/chat` в [`chat.py`](../backend/app/api/chat.py) |
| Массовый перенос задач | ГОТОВО | MCP-инструмент `move_tasks` в [`server.py`](../backend/app/mcp/server.py), тесты оркестрации в [`test_chat.py`](../backend/tests/test_chat.py) |
| Изменение зависимостей | ГОТОВО | MCP-инструменты добавления, удаления и замены предшественников в [`server.py`](../backend/app/mcp/server.py), граф зависимостей в [`graph.py`](../backend/app/domain/graph.py) |
| Создание задач | ГОТОВО | MCP-инструмент `create_task`, правила TASK-ID и размещения задачи в [`server.py`](../backend/app/mcp/server.py) и [`ids.py`](../backend/app/domain/ids.py) |
| Перераспределение исполнителей | ГОТОВО | MCP-инструмент `set_assignee` в [`server.py`](../backend/app/mcp/server.py) |
| Отражение изменений на диаграмме и предварительный просмотр | ГОТОВО | [`PendingPanel.tsx`](../frontend/src/components/PendingPanel.tsx), [`gantt-preview-overlay.ts`](../frontend/src/gantt-preview-overlay.ts), endpoint Apply в [`planning.py`](../backend/app/api/planning.py) |
| Карточка задачи | ГОТОВО | Доступная только для чтения [`TaskModal.tsx`](../frontend/src/components/TaskModal.tsx) |
| Экспорт Excel | ГОТОВО | [`excel_export.py`](../backend/app/services/excel_export.py), `POST /api/export` и Playwright-тест повторного импорта в [`state-excel.spec.ts`](../frontend/e2e/state-excel.spec.ts) |
| Frontend на React | ГОТОВО | [`frontend/package.json`](../frontend/package.json), [`App.tsx`](../frontend/src/App.tsx) |
| Backend на Python/FastAPI | ГОТОВО | [`backend/pyproject.toml`](../backend/pyproject.toml), [`main.py`](../backend/app/main.py) |
| Реальный MCP | ГОТОВО | Официальные MCP client/server в [`mcp/client.py`](../backend/app/mcp/client.py) и [`mcp/server.py`](../backend/app/mcp/server.py); модель обращается к инструментам через эту границу |
| LLM через API | ГОТОВО | Адаптер Qwen/OpenAI-compatible API в [`qwen.py`](../backend/app/ai/qwen.py); запрос к production-модели принят при ручной проверке |
| Обязательные колонки Excel | ГОТОВО | Детерминированный parser в [`excel_import.py`](../backend/app/services/excel_import.py), сохранённый в репозитории [`sample_tasks.xlsx`](../sample/sample_tasks.xlsx) |
| Git-репозиторий | ГОТОВО | Версионируемые исходники, тесты, документация и автоматизация поставки в текущем репозитории |
| Развёрнутое приложение | ГОТОВО | Публичный [production URL](https://bbaqdcimsde8vli202gq.containers.yandexcloud.net/) без авторизации |
| README и локальный запуск | ГОТОВО | [`README.md`](../README.md), построенный для первичного знакомства проверяющего |
| Архитектура и решения | ГОТОВО | [`ARCHITECTURE.md`](ARCHITECTURE.md), утверждённый [`Master Brief`](AI_Gantt_Planner_Master_Brief_v1.3.md) |
| Раскрытие использования AI-ассистентов | ГОТОВО | Раздел «Использование AI-ассистентов» в [`README.md`](../README.md#использование-ai-ассистентов-при-разработке) |
| Демо: загрузка Excel → изменение через чат → экспорт | **ГОТОВО** | [Production demo video](demo/ai-gantt-demo.mp4) показывает реальную цепочку Excel import → Qwen-команда → preview/Apply → Excel export; сценарий описан в [`demo/README.md`](demo/README.md) |
| Пример Excel | ГОТОВО | [`sample/sample_tasks.xlsx`](../sample/sample_tasks.xlsx) проходит автоматическую проверку обычного Replace import |
| Roadmap to Production | ГОТОВО | [`ROADMAP_TO_PRODUCTION.md`](ROADMAP_TO_PRODUCTION.md) |

## Финальная проверка перед отправкой

1. Убедиться, что [`docs/demo/ai-gantt-demo.mp4`](demo/ai-gantt-demo.mp4) открывается из GitHub.
2. Проверить доступность [production URL](https://bbaqdcimsde8vli202gq.containers.yandexcloud.net/) без авторизации.
3. Отправлять работодателю ссылку на репозиторий и production URL; все обязательные материалы находятся в репозитории.

Все пункты исходного задания подтверждены репозиторием, развёрнутым приложением
или финальной production-записью. Проверяющему не нужна авторизация Yandex Cloud
для открытия приложения.
