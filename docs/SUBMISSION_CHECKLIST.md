# Матрица требований к сдаче

Статусы:

- **ГОТОВО** — требование подтверждено файлами репозитория или развёрнутым
  приложением.
- **ТРЕБУЕТСЯ ЗАПИСЬ** — функциональность проверена, но человек должен записать
  финальную демонстрацию в production.

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
| Демо: загрузка Excel → изменение через чат → экспорт | **ТРЕБУЕТСЯ ЗАПИСЬ** | Сценарий записи в production и путь итогового файла указаны в [`demo/README.md`](demo/README.md); видео ещё не записано |
| Пример Excel | ГОТОВО | [`sample/sample_tasks.xlsx`](../sample/sample_tasks.xlsx) проходит автоматическую проверку обычного Replace import |
| Roadmap to Production | ГОТОВО | [`ROADMAP_TO_PRODUCTION.md`](ROADMAP_TO_PRODUCTION.md) |

## Действия перед отправкой

1. Записать демонстрацию production-версии с реальным AI-провайдером по
   [`docs/demo/README.md`](demo/README.md).
2. Добавить `docs/demo/ai-gantt-demo.mp4` и убедиться, что ссылка/файл открывается
   после нового клонирования репозитория.
3. Перед отправкой проверить доступность production URL и выбрать commit,
   содержащий видео.

Все остальные пункты подтверждены репозиторием или развёрнутым приложением.
Проверяющему не нужна авторизация Yandex Cloud для открытия production URL.
