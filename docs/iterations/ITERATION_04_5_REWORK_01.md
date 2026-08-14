# Iteration 04.5 — Rework 01: Gantt sizing + Russian demo data

**Status:** REWORK  
**Base implementation:** `6a42a70569f84876ad510f83f969b12318f05afa`  
**Source of truth:** `docs/AI_Gantt_Planner_Master_Brief_v1.3.md` + approved human-QA findings below

## Human-QA findings

1. After bounded timeline was introduced, the actual Frappe timeline/SVG occupies only the left part of the Gantt card on a wide desktop viewport, leaving a large empty white region on the right. This is a visual regression.
2. Seed/demo task names, descriptions and assignee display names are still English while the product UI is Russian.
3. In the task modal, relation rows under `Зависит от` / `Влияет на` should show the full public task ID plus task name. The compact-number experiment caused ambiguity and is reverted for modal relations.

## 1. Fix bounded timeline sizing regression

Keep the approved bounded-timeline behavior and do not restore Frappe infinite padding.

Current issue: the custom Week timeline uses a fixed `column_width` and a bounded number of columns. On wide screens this can produce an SVG/timeline narrower than its Gantt card, so the chart ends early and the remaining card is blank.

Required behavior:

- The timeline must visually fill at least 100% of the available Gantt viewport width.
- Preserve semantic time scale: do not stretch individual dates arbitrarily in a way that makes equal date intervals inconsistent.
- For short plans, calculate an effective column width / bounded visual range so the project timeline plus its approved pre/post buffer fills the available chart viewport naturally.
- For long plans, keep a readable minimum column width and allow native horizontal scrolling.
- Recalculate sizing when:
  - the browser/container width changes;
  - AI side panel opens/closes;
  - view mode changes;
  - current/proposed plan range changes.
- The first task must not be clipped on initial render.
- Preserve the approved bounds policy:
  - Day: small ~3-day context before/after actual plan;
  - Week: calendar weeks Monday–Sunday with one contextual week around the project;
  - Month: approximately one contextual month around the project.
- No large dead white area may remain inside the Gantt card after the actual timeline grid ends.
- Do not solve this by bringing back a month of meaningless padding on every viewport.

Human QA should verify both AI panel closed and open at the current desktop width.

## 2. Russian demo/seed content

The employer-facing seeded demo must be fully Russian except for conventional technical terms where they are naturally used in Russian.

Keep all `TASK-NNN`, internal UUIDs, dates, durations and dependency graph unchanged. Translate only user-facing seed content.

Use this approved seed copy:

- `TASK-001`
  - name: `Исследование продукта`
  - description: `Уточнить сценарий демонстрации и критерии приёмки.`
  - assignee: `Анна`
- `TASK-002`
  - name: `UX-дизайн`
  - description: `Подготовить основной пользовательский сценарий планирования.`
  - assignee: `Мария`
- `TASK-003`
  - name: `Основа бэкенда`
  - description: `Реализовать базовую архитектуру API планировщика.`
  - assignee: `Сергей`
- `TASK-004`
  - name: `Основа фронтенда`
  - description: `Собрать базовый интерфейс веб-приложения.`
  - assignee: `Елена`
- `TASK-005`
  - name: `Интеграция приложения`
  - description: `Связать frontend и backend в единый пользовательский сценарий.`
  - assignee: `Сергей`
- `TASK-006`
  - name: `Сквозное тестирование`
  - description: `Проверить полный пользовательский сценарий приложения.`
  - assignee: `Олег`
- `TASK-007`
  - name: `Подготовка демо`
  - description: `Подготовить финальную демонстрацию решения.`
  - assignee: `Анна`

Update code/tests/fixtures that intentionally assert seed user-facing values. Do not translate technical source-code identifiers or API field names.

Any user-facing sample workbook/demo dataset delivered with the assignment must use the same Russian naming by final delivery. If changing the binary sample workbook is outside this narrow rework, explicitly leave it as a delivery follow-up instead of silently forgetting it.

After this change, `Восстановить демо` must restore the Russian seed plan.

## 3. Modal relation clarity

Current task identification remains:

- modal header: full `TASK-NNN` for the currently opened task;
- Gantt label: compact numeric display is acceptable.

For relation lists in the modal revert to explicit full references:

```text
Зависит от
TASK-006 · Сквозное тестирование

Влияет на
TASK-008 · ...
```

Requirements:

- show full related-task `TASK-NNN` plus name;
- never show internal UUIDs;
- do not use bare compact numbers in modal relation lists;
- keep `Нет` when there are no relations.

## Regression coverage

At minimum cover:

- seed plan has the same IDs/dates/dependencies/durations but approved Russian names/descriptions/assignees;
- Restore demo restores Russian seed values;
- numeric/public task resolution still maps `задача 7` to `TASK-007` after assignee/name localization;
- existing Sergey-based tests are updated to `Сергей` where they represent user-facing data;
- modal relation rows contain full public ID + Russian task name and no UUID;
- timeline sizing helper produces a viewport-filling configuration for a short bounded plan and a scrollable/readable configuration for a long plan;
- resizing the Gantt container / opening AI does not leave the timeline narrower than the visible Gantt viewport;
- existing direct drag/resize, pending preview, chat, Excel, localStorage and backend regression suites remain green.

Run full backend tests, frontend tests, lint, TypeScript/build, dependency checks/audit and `git diff --check`.

## Locked scope

Do not:

- remove bounded timeline behavior;
- restore `infinite_padding`;
- change approved scheduling/business rules;
- change TASK IDs, UUIDs, dates or dependency graph of the seed;
- rewrite direct manipulation or ChangeSet architecture;
- start delivery/deployment;
- add unrelated visual redesign.

## Human QA gate

After implementation stop for Human QA. Verify:

1. On the current wide desktop viewport, timeline grid fills the Gantt card with no large blank right-hand region.
2. Open and close AI panel; Gantt resizes/reflows cleanly both ways.
3. Week view remains Monday–Sunday with sensible project bounds.
4. Seed labels/descriptions/assignees are Russian after `Восстановить демо`.
5. Open `TASK-004`: modal shows `TASK-002 · UX-дизайн` under `Зависит от` and `TASK-005 · Интеграция приложения` under `Влияет на`.
6. Drag and right-edge resize still work through the guarded ChangeSet flow.

No delivery/deployment work in this rework.
