# Iteration 04.6 — Autonomous Frontend QA Report

Дата: 2026-08-15

## Среда и покрытие

- Windows, Chromium (Playwright 1.62.1), Node.js 24.15.0, Python 3.12.13.
- Viewport matrix: 1440×900, 1920×1080, 1024×768 и incident viewport 454×866.
- Playwright: 23/23 сценария прошли. Покрыты click/micro-drag, drag/resize, Apply/Cancel, invalid dependency drag, far-edge preview/Apply, edge/pointer/request recovery, no-op response guards, Excel localization/Replace/Append, 21-операционный stress, persistence/Restore, AI drawer/help, Excel round-trip и SVG geometry.
- Core interaction/stress: три последовательных прогона, 12/12 тестов прошли. Каждый повтор включает 21-операционный stress со сменой drag/resize/Apply/Cancel и выходом за обе границы timeline.
- Визуально проверены baseline, AI drawer и same-row Change Preview во всех обязательных размерах, а также исправленные far-edge preview и applied chart на 454×866. Видео не создавалось; диагностические screenshots/traces сохранены только во временных игнорируемых каталогах.

## Rework 01 — no-op ChangeSet guard

### Воспроизведение и root cause

- Воспроизведён утверждённый сценарий: `Перенеси задачу 4 на 11 февраля.`. Детерминированный Finish-to-Start propagation возвращал TASK-004 на уже существующую дату, но `prepare_changeset()` сохранял dependency impact и классифицировал результат как `CONFIRMATION_REQUIRED`, хотя итоговый `proposed_plan` полностью совпадал с authoritative plan.
- Chat orchestration, direct edit и Excel import доверяли статусу подготовленного ChangeSet и не применяли единый post-build guard к полному `PlanState`. Frontend также доверял `confirmation_required`, строил preview с пустым списком изменений и мог показать pending-панель `0 задач`, заблокировав chat/Gantt/Excel до Apply/Cancel.
- До исправления целевые regression-наборы зафиксировали 7 backend failures, 5 frontend failures и 1 Playwright failure. В ходе цикла дополнительно обнаружен эквивалентный direct-edit no-op: запрошенная weekend-дата нормализуется в уже существующую дату задачи.

### Исправление

- В domain добавлен один канонический post-build guard: ChangeSet имеет эффект только когда полный `proposed_plan` существует и не равен исходному `PlanState`. Сравнение включает все поля и порядок задач; apply-time digest/rebuild validation не менялись.
- Guard подключён во всех producer/consumer paths текущего продукта: chat, direct drag/resize и Excel import. No-op не сохраняется в pending state, не вызывает `apply_changes`, не открывает confirmation и возвращает неизменённый authoritative plan.
- Chat возвращает deterministic `clarification_required` с понятным сообщением. Direct edit использует существующий informational/invalid transport без изменения drag/resize UX. Import возвращает `NO_CHANGE`, не меняя workbook/Excel-контракт.
- Frontend повторно валидирует любой входящий confirmation result: необходим `proposed_plan`, полное состояние должно отличаться, а derived preview должен содержать хотя бы одно эффективное изменение. Та же защита очищает persisted zero-effect pending state; `PendingPanel` физически не рендерит пустой preview.
- Добавлены regression-тесты для точного chat-сценария, spy на отсутствие apply, same-value start/duration/assignee, mixed effective batch, complete-plan comparison, direct move/resize/weekend normalization, identical import result, malformed backend responses, persisted pending и реального UI continuation после no-op.

### Автономная визуальная проверка rework

- Отдельная in-app Browser QA-сессия на 1280×720 подтвердила отсутствие pending heading и текста `0 задач`, отсутствие page-level horizontal overflow (`scrollWidth == clientWidth == 1280`), 7 видимых bars и 7 правых resize handles с `pointer-events: auto`; console warnings/errors отсутствовали.
- Локальный live AI provider не настроен, поэтому прямой `/api/chat` корректно показал существующую ошибку конфигурации без pending state. Утверждённый no-op ответ проверен в реальном UI через детерминированный Playwright route interception, как и остальные AI-сценарии Iteration 04.6.
- После no-op chat остаётся доступным, TASK-004 не меняется, а последующий direct drag продолжает штатный confirmation flow. Видео не записывалось; screenshots/traces создавались только для разбора падавших прогонов.

## Rework 02 — локализация Excel validation

### Воспроизведение и root cause

- Воспроизведён captured Replace-сценарий с Append-oriented workbook: validation panel показывала `Unknown predecessor 'Интеграция приложения'` и `Unknown predecessor 'Сквозное тестирование'` без объяснения разрешённой области поиска в Replace mode.
- Parser содержал английские строки для file/workbook, column и row validation и добавлял raw exception text для повреждённой книги. Import resolver использовал одну mode-agnostic английскую формулировку, а current-plan и ChangeSet conflicts передавали `str(error)`/domain message напрямую.
- Frontend показывал machine-readable `code` вместо пользовательской подписи для file-level issue без номера строки. Для длинных сообщений не был зафиксирован явный wrapping contract.
- До исправления целевой прогон зафиксировал 17 backend localization failures, 2 frontend failures и 2 ожидаемых Playwright localization failures. Дополнительно исправлена только тестовая проверка Append: после успешного добавления план штатно содержит 8, а не 7 bars; поведение продукта не менялось.

### Исправление

- Полностью локализованы сообщения `.xlsx` parsing, active worksheet, обязательных колонок, row fields, запрещённого `;`, duplicate names/predecessors, self-reference, mode-specific unknown predecessors и dependency cycles. `UNREADABLE_WORKBOOK` больше не раскрывает текст исключения openpyxl/ZIP.
- Replace теперь детерминированно объясняет, что неизвестный predecessor должен присутствовать отдельной задачей в загружаемом Excel. Append объясняет поиск и в Excel, и в текущем плане.
- Current-plan errors и ChangeSet conflicts локализуются на import boundary по стабильному типу/code; общие domain exceptions, scheduling, ChangeSet semantics и API error codes не изменялись.
- Frontend больше не показывает raw code: file-level issue получает подпись `Файл Excel`, row-level issue сохраняет `Строка N`. Для текста validation issue добавлены `min-width: 0` и `overflow-wrap: anywhere` без изменения структуры панели.
- Stable issue codes, row/column metadata, required columns, unknown-column ignore, active-sheet rule, `;` separator, atomicity и Replace/Append predecessor resolution сохранены.

### Regression и визуальная проверка

- Backend regressions покрывают все file/workbook errors, missing/duplicate columns, row validation, separator rule, duplicates, self-reference, Replace/Append unknown predecessors, public-ID cycle path, invalid current plan, conflict conversion, unknown extra columns и валидные Replace/Append.
- Frontend integration проверяет русские сообщения, отсутствие raw codes/известных английских фрагментов, неизменность PlanState и доступность следующего импорта. Playwright использует реальные временные `.xlsx` fixtures и настоящий FastAPI pipeline: valid Replace, valid Append со ссылкой на demo plan, captured invalid Replace и invalid row.
- В отдельной in-app Browser-сессии на 1280×720 validation panel полностью помещалась в document width (`right 1234 < clientWidth 1265`); оба сообщения имели `overflow-wrap: anywhere` и `scrollWidth == clientWidth == 825`. На странице осталось 7 bars/7 handles, file input был доступен, английских validation fragments и console warnings/errors не было.
- Видео и success-screenshots не создавались. Failure screenshots/traces использовались только в первой падающей итерации и не входят в commit.

## Воспроизведённые дефекты и причины

1. После impacted drag и `Применить всё` автоматически открывалась карточка TASK-007. Frappe SVG animation генерировала untrusted synthetic `click` для обновлённых bars, а task-scoped suppression token очищался при preview/chart reconstruction и мог потребляться во время legitimate interaction lock.
2. После прерванных и краевых жестов drag/resize мог восприниматься как недоступный. Завершение gesture было привязано к container/pointer-capture happy path: outside release, `pointercancel`, `lostpointercapture` и detached SVG capture не имели единого безопасного cleanup/reconciliation пути. Автоматически открытый modal из первого дефекта дополнительно перекрывал Gantt.

## Live incident 2026-08-15

### Зафиксированное состояние

- Пользовательский diagnostic JSON сохранён без изменений в `tmp/qa/live-incident/live-state-2026-08-15T130332Z.json` (SHA-256 `5C52E68431D009A3DF76FD3BF1AA26CC6B3A2E8EA70B22785BBAAA3E7BE1E56E`). Каталог `tmp/` игнорируется Git и snapshot не входит в commit.
- Snapshot: `http://127.0.0.1:5173/`, viewport 454×866, DPR 2; 7 bars, 7 right handles, 0 preview nodes, 0 modal, `pendingChange: null`, host `gantt-interactive`, blocking classes отсутствуют, pointer-events у wrappers и handles равен `auto`.
- Persisted plan показывает уже применённый дальний перенос TASK-006 на 12–23 марта и зависимой TASK-007 на 24–25 марта. Opacity 0 у handles в snapshot соответствует штатному hidden-until-hover CSS и сама по себе не является interaction lock.
- Прямой CDP-доступ к исходной вкладке оказался недоступен. Поэтому исходные console/page errors, незавершённые requests, browser event listeners, pointer capture и React refs не могли быть ретроспективно извлечены; вкладка не обновлялась и evidence не уничтожалось. Процессы на портах 5173 и 8000 не перезапускались.

### Точные причины

1. Белая область справа возникала при far impacted preview: Frappe строил сетку только по текущим rendered bars, а padding вычислялся из относительного выравнивания proposed plan. В воспроизведении ширина grid была 980 px при правой границе proposed overlay 1000 px.
2. Resize исчезал после Apply, потому что preview реконструировал Frappe в `readonly_dates`-режиме без handles. После Apply границы combined preview и applied plan совпадали, layout signature не менялась, и readonly-инстанс переиспользовался; контролируемое воспроизведение фиксировало 0 right handles.
3. Drag становился недоступен после прерывания жеста, потому что Frappe хранит mouse drag state во внутреннем closure и сбрасывает его только на штатном `mouseup`. React cleanup после `pointercancel`/`lostpointercapture` исправлял SVG-геометрию, но не мог очистить внутренний state старого экземпляра.
4. Modal после Apply мог открыться из-за delayed untrusted click, который создаёт SVG animation Frappe после обновления bar. Task-scoped suppression из предыдущего исправления корректно блокирует такой click; far-edge regression дополнительно подтверждает отсутствие modal после 400 ms и нормальный следующий deliberate click.

### Incident-исправления

- Padding каждого view mode теперь рассчитывается между фактически rendered task bounds и полным target timeline, включая far proposed dates; proposed/current SVG-геометрия не может выйти за календарную сетку.
- Readonly preview и interactive plan включены в layout signature как разные состояния, поэтому Apply/Cancel всегда создаёт корректный interactive Frappe с правыми resize handles.
- `pointercancel` и `lostpointercapture` форсируют безопасную chart reconstruction через recovery epoch. Это сбрасывает внутренние Frappe listeners/state, pending provisional dates и восстанавливает authoritative geometry.
- Добавлены сначала падавшие unit/E2E regressions для far padding, far Apply unlock и реального Frappe-state после pointer cancellation. До исправления они падали соответственно с padding `7d/4d` вместо `7d/27d`, выходом overlay за grid, 0 handles и stale x-coordinate.
- Stress расширен до 21 последовательной операции: обычные и far-edge drag/resize, invalid request, Apply, Cancel, state restore и повторная проверка обоих deterministic flows.

## Исправления

- Suppression сохраняется через pending preview, Apply/Cancel и chart reconstruction; новый deliberate pointer-down возвращает обычный click contract.
- Synthetic Frappe clicks блокируются в capture phase без фиксированного timeout и без блокировки следующего реального пользовательского click.
- Добавлены guarded pointer capture/release, document-level completion, обработка cancel/lost capture/outside release и authoritative geometry recovery.
- Добавлены unit regression tests для Apply lifecycle и lost pointer capture, а также полный детерминированный Playwright harness.

## Дополнительные дефекты

- Анимация AI drawer временно создавала page-level horizontal overflow на 7–8 px. Overflow ограничен на уровне app shell; внутренняя горизонтальная прокрутка Gantt сохранена и проверена.
- Vitest первоначально собирал Playwright specs. Каталог `e2e` явно исключён из unit-test discovery.
- E2E helpers теперь ожидают завершения разрешённой chart reconstruction, не подменяя её произвольной задержкой.

## Итоговые проверки

- Frontend unit/integration: 93/93.
- Frontend lint: passed.
- TypeScript + production build: passed.
- Backend: 140/140.
- Python dependency check: passed.
- Frontend dependency tree: passed (`npm ls --all`; отсутствуют broken required dependencies).
- Frontend Playwright: 23/23; Excel localization subset: 4/4; no-op subset: 2/2; incident subset: 3/3; трёхкратный core repeat: 12/12.
- Неожиданные `pageerror`, console errors и application request failures: отсутствуют во всех прошедших E2E сценариях.
- Live Qwen не запускался: обязательный AI happy path перехватывался валидным детерминированным ответом согласно iteration brief; локальная конфигурация provider отсутствует. Это не блокер стандартного QA.

## Готовность

Неразрешённых implementation defects и вопросов, требующих нового product/business/security решения, не найдено.

**Ready for final human smoke test: YES.**
