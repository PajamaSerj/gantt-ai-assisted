# Iteration 04.6 — Rework 02: Excel import error localization

Status: REWORK  
Base commit: `2f2f9f7b17458d5c699f890db15e5b44be9c7f44`  
Source of truth: `docs/AI_Gantt_Planner_Master_Brief_v1.3.md`

## Human QA finding

The Russian application UI still exposes English validation messages during Excel import.

Captured example in Replace mode:

```text
Unknown predecessor 'Интеграция приложения'
Unknown predecessor 'Сквозное тестирование'
```

The validation itself is correct: the uploaded Append-oriented workbook references tasks from the current board, while Replace mode may resolve predecessors only inside the uploaded workbook. The defect is the mixed-language user-facing message.

This is the final functional polish before delivery/deployment packaging. Do not expand import behavior.

## Goal

Make all user-facing Excel import validation messages consistent, concise and fully Russian while preserving stable machine-readable error codes and current validation semantics.

```text
code remains stable for tests/API
message becomes product-language Russian for the user
```

## Locked scope

Do not change:

- required Excel columns;
- active worksheet behavior;
- Replace/Append semantics;
- predecessor resolution rules;
- task-name uniqueness;
- `;` predecessor separator;
- scheduling, ChangeSet or no-op semantics;
- accepted optional fields;
- unknown-column behavior;
- AI/MCP behavior;
- Gantt behavior;
- deployment.

Do not silently make the Append-oriented workbook valid for Replace.

---

# Part A — Localize the complete Excel validation surface

Audit all messages that can be returned to the user from:

- `.xlsx` parsing;
- workbook/worksheet structural validation;
- row validation;
- predecessor resolution;
- graph/cycle validation;
- current-plan validation during import;
- import ChangeSet conflict conversion;
- frontend fallback messages for import validation.

Keep error `code` values unchanged. Localize only the user-facing `message` unless a code is itself displayed in the UI, in which case hide or map it rather than renaming the API contract.

## A1. File and workbook errors

Expected product-language meanings:

- `INVALID_EXTENSION` → `Поддерживаются только файлы .xlsx.`
- `UNREADABLE_WORKBOOK` → `Не удалось прочитать Excel-файл. Проверьте, что файл не повреждён и имеет формат .xlsx.`
- `MISSING_ACTIVE_WORKSHEET` → `В книге нет активного листа.`
- `EMPTY_WORKSHEET` → `Активный лист пуст.`
- `NO_TASK_ROWS` → `На активном листе нет строк с задачами.`

Do not expose raw Python/library exception text to the user. Technical details may be logged internally if the current logging approach supports it, but are not required in this rework.

## A2. Column errors

Expected meanings:

- duplicate required column → `Обязательная колонка «{column}» указана больше одного раза.`
- missing required column → `Не найдена обязательная колонка «{column}».`

Preserve row and column metadata.

Unknown columns continue to be ignored and must not produce warnings or errors.

## A3. Row errors

Expected meanings:

- missing task name → `Укажите название задачи.`
- invalid task name / forbidden `;` → use a concise Russian explanation consistent with the domain rule;
- duplicate task name inside Excel → `Название задачи «{name}» повторяет строку {row}. Названия задач должны быть уникальными.`
- duplicate against current plan in Append → `Задача «{name}» уже существует в текущем плане как {TASK-ID}.`
- invalid duration → `Длительность должна быть положительным целым числом рабочих дней.`
- invalid predecessor cell type → `Предшественники должны быть указаны названиями задач через «;».`
- duplicate predecessor → `Предшественник «{name}» указан повторно.`
- self-reference → `Задача «{name}» не может зависеть сама от себя.`

Use Russian quotation marks where practical and keep messages short enough for the current validation panel.

## A4. Unknown predecessor must explain import mode

This is the mandatory captured regression.

### Replace mode

When a predecessor is absent from the uploaded workbook:

```text
Предшественник «Интеграция приложения» не найден. В режиме замены он должен быть отдельной задачей в загружаемом Excel.
```

### Append mode

When a predecessor is absent both from the uploaded workbook and the current plan:

```text
Предшественник «{name}» не найден ни в загружаемом Excel, ни в текущем плане.
```

The message must be selected deterministically from `ImportMode`; do not infer the mode in the frontend.

## A5. Dependency cycle

Replace English cycle text with Russian while preserving the deterministic public-ID path:

```text
Обнаружен цикл зависимостей: TASK-001 → TASK-003 → TASK-006 → TASK-001.
```

## A6. Current-plan and ChangeSet conflicts

Audit domain/conflict messages that can surface through import.

If a domain exception is still English, translate/map it at the import boundary or localize the shared domain exception only when doing so cannot regress other Russian UI paths.

The user must not see mixed Russian/English sentences in the Excel validation panel.

---

# Part B — Frontend presentation

Preserve the current validation panel structure:

- `Импорт не применён`;
- `Исправьте ошибки в Excel`;
- row reference such as `Строка 2`;
- one concise error message per issue.

Required behavior:

- no raw error code in the visible message;
- no `Unknown predecessor`, `Task name`, `Duration must`, `Dependency cycle detected`, `Workbook cannot be read` or equivalent English fragments;
- long messages wrap cleanly without breaking the Gantt layout;
- validation failure does not mutate PlanState;
- user can immediately choose another file or restore demo according to the existing flow.

Do not add a new modal or redesign the import experience.

---

# Part C — Regression coverage

## Backend/parser/service tests

Add or update focused tests proving at minimum:

1. Captured Replace import returns two Russian unknown-predecessor messages for `Интеграция приложения` and `Сквозное тестирование`.
2. Append unknown predecessor uses the Append-specific Russian wording.
3. Missing/duplicate required columns are Russian.
4. Missing name, invalid duration and invalid predecessor format are Russian.
5. Duplicate task name, duplicate predecessor and self-reference are Russian.
6. Dependency cycle message is Russian and includes the public-ID cycle path.
7. Invalid extension, unreadable workbook, empty workbook and no-task-rows messages are Russian.
8. Stable machine-readable issue codes and row/column metadata are unchanged.
9. Unknown extra columns remain ignored.
10. A valid Replace workbook and valid Append workbook still import normally.

## Frontend unit/integration

11. The validation panel renders Russian messages and row references.
12. No known English validation fragments are visible.
13. Validation failure leaves the current plan unchanged.
14. Multiple issues render without overflow or broken layout.

## Playwright smoke

Use deterministic fixtures to check:

- valid self-contained Replace import succeeds;
- valid Append import referencing the demo plan succeeds;
- invalid Replace of the Append-oriented file shows the two localized predecessor errors;
- one row-level invalid workbook shows localized validation messages;
- no page errors, console errors or unexpected failed requests.

No video is required. Screenshots/traces only on failure and do not commit generated output.

---

# Sample fixture alignment

The final repository/sample package will contain separate workbooks for different purposes:

- self-contained valid Replace sample;
- valid Append sample that intentionally references current demo tasks;
- invalid validation sample.

Do not make one workbook pretend to support both Replace and Append when its dependency contract is mode-specific.

This rework should make the mode distinction clear through validation messages, not change the files' intended semantics.

---

# Autonomous QA loop

Follow the Iteration 04.6 process:

```text
reproduce English error
→ add failing regression
→ localize at the correct backend boundary
→ run targeted tests
→ run full backend/frontend/Playwright suites
→ inspect the real validation panel
→ fix any remaining mixed-language import message
→ repeat until clean
```

Update:

`docs/qa/ITERATION_04_6_AUTONOMOUS_QA_REPORT.md`

with the localization regression, test results and final readiness.

## Acceptance criteria

Rework is accepted only when:

- the captured unknown-predecessor errors are fully Russian and explain Replace mode;
- Append unknown-predecessor wording reflects Append resolution scope;
- all user-facing Excel validation messages are Russian;
- error codes and validation semantics remain stable;
- valid Replace and Append imports still work;
- no PlanState mutation occurs on validation failure;
- all relevant unit, backend and Playwright checks pass;
- one commit is created and the worktree is clean.

## Verification

Run:

- targeted Excel parser/import tests;
- full backend suite;
- Python dependency check;
- targeted frontend validation tests;
- full frontend unit/integration suite;
- frontend lint;
- TypeScript / production build;
- Playwright Excel regression subset and full E2E suite;
- `git diff --check`;
- final clean `git status`.

Create one commit and stop for final Human smoke test. Do not start Iteration 05 or deployment.
