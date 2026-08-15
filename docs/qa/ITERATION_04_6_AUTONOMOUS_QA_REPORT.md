# Iteration 04.6 — Autonomous Frontend QA Report

Дата: 2026-08-15

## Среда и покрытие

- Windows, Chromium (Playwright 1.62.1), Node.js 24.15.0, Python 3.12.13.
- Viewport matrix: 1440×900, 1920×1080, 1024×768 и incident viewport 454×866.
- Playwright: 17/17 сценариев прошли. Покрыты click/micro-drag, drag/resize, Apply/Cancel, invalid dependency drag, far-edge preview/Apply, edge/pointer/request recovery, 21-операционный stress, persistence/Restore, AI drawer/help, Excel round-trip и SVG geometry.
- Core interaction/stress: три последовательных прогона, 12/12 тестов прошли. Каждый повтор включает 21-операционный stress со сменой drag/resize/Apply/Cancel и выходом за обе границы timeline.
- Визуально проверены baseline, AI drawer и same-row Change Preview во всех обязательных размерах, а также исправленные far-edge preview и applied chart на 454×866. Видео не создавалось; диагностические screenshots/traces сохранены только во временных игнорируемых каталогах.

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

- Frontend unit/integration: 83/83.
- Frontend lint: passed.
- TypeScript + production build: passed.
- Backend: 123/123.
- Python dependency check: passed.
- Frontend dependency tree: passed (`npm ls --all`; отсутствуют broken required dependencies).
- Frontend Playwright: 17/17; incident subset: 3/3; трёхкратный core repeat: 12/12.
- Неожиданные `pageerror`, console errors и application request failures: отсутствуют во всех прошедших E2E сценариях.
- Live Qwen не запускался: `/api/chat` перехватывался валидным детерминированным ответом согласно iteration brief. Это не блокер стандартного QA.

## Готовность

Неразрешённых implementation defects и вопросов, требующих нового product/business/security решения, не найдено.

**Ready for final human smoke test: YES.**
