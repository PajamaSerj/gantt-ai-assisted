# Iteration 04.6 — Rework 01: No-op ChangeSet handling

Status: REWORK  
Base commit: `bbb45331c8dd93d6fb866b8faf8eee1b885cd8b3`  
Source of truth: `docs/AI_Gantt_Planner_Master_Brief_v1.3.md`

## Human QA finding

The AI request `Перенеси задачу Елены на день назад` can produce a pending confirmation with:

- badge `0 задач`;
- an empty Gantt preview;
- active `Применить всё / Отменить` controls;
- blocked chat while the user is asked to approve a change that has no effect.

In the captured scenario:

- `TASK-004 · Основа фронтенда` currently starts on 11 February 2026;
- it depends on `TASK-002 · UX-дизайн`, which ends on 10 February 2026;
- the requested move to 10 February is rejected by deterministic Finish-to-Start scheduling;
- the final proposed plan is therefore identical to the current plan;
- nevertheless the chat path returns `confirmation_required`.

This is a product and state-machine defect. A no-op must never create a pending decision.

## Goal

Introduce a consistent no-op contract across ChangeSet preparation consumers:

```text
if final proposed PlanState == current PlanState
→ no pending confirmation
→ no Apply/Cancel controls
→ no preview overlay
→ no interaction lock
→ concise product-language explanation
```

The backend remains authoritative. The frontend also adds a defensive guard so a malformed zero-effect confirmation can never display `0 задач` or lock the UI.

## Locked scope

Do not change:

- scheduling semantics;
- Finish-to-Start rules;
- working-day calendar;
- ChangeSet apply-time validation;
- AI/MCP tool permissions;
- drag/resize behavior;
- same-row preview design;
- Excel contract;
- deployment.

Do not introduce an artificial change solely to avoid a no-op.

---

# Part A — Canonical effective-change detection

## A1. One deterministic helper

Add or reuse one deterministic comparison for deciding whether a prepared ChangeSet changes the plan.

Required semantic rule:

- compare the complete final `proposed_plan` with the source/current `PlanState`;
- internal task ordering, IDs, dependencies, dates, duration, assignee, name, description and created source remain part of the authoritative state;
- do not decide only from `affected_tasks`, requested change count or confirmation reasons;
- if `proposed_plan` is missing, treat the ChangeSet according to its existing invalid/error path, not as a no-op.

A helper such as `changeset_has_effect(changeset, source_plan)` or equivalent is acceptable.

## A2. Entire batch versus partial no-op

Only classify the whole request as no-op when the final proposed plan equals the source plan.

If a batch contains multiple requested changes and at least one produces a real final-state difference, keep the normal Apply/confirmation behavior for the effective result. Do not reject the whole batch merely because one requested operation was redundant.

---

# Part B — Chat orchestration

## B1. No confirmation for identical final plan

After `planning_context.prepare()` and before returning `confirmation_required` or invoking `apply_changes`, check whether the final proposed plan differs from the request plan.

When it does not differ:

- return `clarification_required` using the existing public Chat API contract;
- return the unchanged current plan;
- `pending_changeset` must be `null`;
- `available_options` must be empty;
- do not expose `apply_changes` or call it;
- preserve conversation context with the explanatory assistant response.

Do not add a new public status unless a real technical incompatibility is found and reported before implementation.

## B2. Product-language explanation

Return the most specific deterministic explanation that can be established from the requested changes and plan.

### Dependency-bound move

For the captured scenario, expected meaning:

```text
Задачу 4 нельзя перенести на день назад: она уже начинается в первый рабочий день после TASK-002 · UX-дизайн — 11 февраля.
```

Equivalent concise Russian wording is acceptable, but it must include:

- the target task reference;
- that the earlier move is blocked by the predecessor/Finish-to-Start boundary;
- the predecessor reference;
- the earliest valid start date.

Support multiple predecessors by identifying the predecessor that determines the current minimum start.

### Requested current value

When the request explicitly sets a value already present, use a deterministic explanation where practical:

- same start date: `Задача уже начинается ...`;
- same duration: `Длительность задачи уже составляет ...`;
- same assignee: `Исполнитель уже назначен ...`;
- same dependency set/name/description: explain that the requested value is already set.

### Safe generic fallback

For a no-op that cannot be explained more specifically:

```text
Изменение не требуется: после проверки правил план остаётся без изменений.
```

Never ask the model to invent the reason after the deterministic engine has already established the no-op.

## B3. Existing successful flows stay unchanged

Verify that:

- a real auto-applicable move still applies;
- a real impacted move still returns confirmation;
- an invalid structural request still follows the invalid/clarification path;
- help/read-only queries remain unchanged;
- no-op handling does not weaken apply-time digest validation.

---

# Part C — Other ChangeSet consumers

Audit the current direct-edit and import flows for the same invariant.

## C1. Direct edits

Preserve the existing dependency-bound no-op handling and concise message. Refactor to the canonical helper only if this reduces duplication without changing behavior.

## C2. Import

If an import produces a final plan identical to the current plan:

- do not show a confirmation preview with zero changed tasks;
- do not apply a meaningless ChangeSet;
- return or surface a concise `План уже содержит эти данные` / equivalent informational result using the existing API shape where possible.

Do not expand Excel behavior beyond this no-op invariant.

---

# Part D — Frontend defensive guard

The backend fix is primary. Add a frontend safety net for any pending source (`chat`, `direct`, `import`).

Before storing/rendering a pending ChangeSet:

- confirm that `proposed_plan` exists;
- confirm that it differs from the current PlanState;
- confirm that the derived pending preview contains at least one effective task change.

If a response claims confirmation but has zero effective changes:

- do not set `planner.pendingChange`;
- do not render the upper pending panel;
- do not render `0 задач`;
- do not show Apply/Cancel;
- keep chat, Excel and Gantt interaction available;
- show a concise non-blocking informational message or use the backend assistant message;
- log no console error for a handled no-op.

The upper pending panel should also defensively return no content when its effective change list is empty. It must never present a decision card with zero tasks.

Do not hide real malformed data silently: if `confirmation_required` lacks a valid `proposed_plan`, use the existing handled error path rather than pretending it is a no-op.

---

# Regression coverage

## Backend/domain

Add focused tests proving at minimum:

1. AI/MCP prepares a move of `TASK-004` from 11 February to 10 February on the demo plan.
2. Deterministic scheduling returns the final plan unchanged because of `TASK-002`.
3. Chat response is `clarification_required`, has no pending ChangeSet/options and contains the dependency-bound explanation.
4. `apply_changes` is not called for the no-op.
5. Moving a task to its existing start date returns a no-op explanation without pending state.
6. Setting an already assigned assignee or already current duration does not create pending state.
7. A mixed batch with at least one effective change still processes the effective final plan normally.
8. A real impacted move still returns `confirmation_required`.
9. A real safe move still returns `applied`.
10. Existing direct-edit dependency-bound tests continue to pass.

Use fake providers/MCP calls; live Qwen credentials are not required.

## Frontend unit/integration

11. A synthetic `confirmation_required` response whose `proposed_plan` equals the current plan does not set pending state.
12. No `0 задач`, Apply or Cancel controls are rendered.
13. Chat input and Gantt interactions remain enabled.
14. A real non-empty confirmation still renders the normal pending summary and preview.
15. Pending panel does not render when its effective changes array is empty.
16. Apply/Cancel behavior for real changes remains unchanged.

## Playwright E2E

Add the captured browser scenario:

1. Restore demo.
2. Open AI drawer.
3. Send `Перенеси задачу Елены на день назад` using the deterministic intercepted/fake AI path that requests the relevant move.
4. Verify the response explains the dependency boundary.
5. Verify no pending heading, badge, preview overlay, Apply or Cancel controls appear.
6. Verify chat remains usable.
7. Verify TASK-004 dates remain unchanged.
8. Verify a subsequent valid AI/direct edit works.
9. Verify no page errors, console errors or failed unexpected requests.

Also add a defensive E2E/API-mock scenario where frontend receives an invalid zero-effect confirmation and refuses to lock itself.

---

# Autonomous QA loop

Use the Iteration 04.6 autonomous workflow:

```text
reproduce
→ add failing regression
→ diagnose
→ fix
→ run targeted tests
→ run full unit/backend/E2E suites
→ inspect the real browser UI
→ fix any obvious related defect
→ repeat until clean
```

Do not stop after implementing only the captured case. Audit all current ChangeSet consumers for the same zero-effect invariant.

No video is required. Screenshots/traces may be generated only on failure and must not be committed.

Update:

`docs/qa/ITERATION_04_6_AUTONOMOUS_QA_REPORT.md`

with:

- reproduced no-op defect;
- root cause;
- backend and frontend guards added;
- scenarios/test counts;
- any additional no-op defects found and fixed;
- final readiness for Human smoke test.

---

# Acceptance criteria

Rework is accepted only when:

- an unchanged final PlanState never produces confirmation;
- the captured TASK-004 request produces a concise dependency-bound explanation;
- no pending panel can display `0 задач`;
- no Apply/Cancel controls appear for a no-op;
- the UI remains fully usable after the response;
- real confirmation/apply flows remain intact;
- direct edit and import no-op behavior satisfy the same invariant;
- all relevant unit, backend and Playwright tests pass;
- the autonomous QA report is updated;
- one rework commit is created and the worktree is clean.

# Verification

Run:

- targeted backend chat/ChangeSet tests;
- full backend suite;
- Python dependency check;
- targeted frontend tests;
- full frontend unit/integration suite;
- frontend lint;
- TypeScript / production build;
- Playwright no-op regression and full E2E suite;
- core interaction/stress repeat where practical;
- `git diff --check`;
- final clean `git status`.

Create one commit and stop for final Human smoke test. Do not start Iteration 05 or deployment.
