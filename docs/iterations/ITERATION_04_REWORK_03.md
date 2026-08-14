# Iteration 04 — Rework 03: Change Preview Clarity + Chat Controls

**Status:** REWORK  
**Base implementation:** `2a2245e1a1596ea6ba578957f42230edab996501`  
**Source of truth:** `docs/AI_Gantt_Planner_Master_Brief_v1.3.md` + approved human-QA findings below

## Why this rework exists

Human QA after Rework 02 confirmed that the main product shell is much closer to the target quality, but exposed one important semantic UX defect: pending ChangeSet preview currently highlights affected tasks without actually showing their proposed positions on the Gantt. The user therefore sees “what is related to the change” instead of “what will happen if I apply it”. This is misleading for a planning product.

This rework is intentionally narrow. Preserve accepted scheduling, ChangeSet validation, MCP, Qwen, Excel, localStorage and read-only Gantt rules. Do not begin delivery/deployment.

## 1. Task modal relations — remove numeric prefixes

The current task's own public ID remains visible in the modal header as the full `TASK-NNN` value.

For related tasks inside `Зависит от` / `Влияет на`:

- remove compact numeric prefixes such as `6 · End-to-end QA`;
- show the related task name only, e.g. `End-to-end QA`;
- do not show UUIDs;
- keep the relation labels `Зависит от` and `Влияет на`.

Rationale: a compact number next to a related task can be visually mistaken for the ID/index of the currently opened task.

## 2. Chat keyboard behavior

Desktop chat composer behavior:

- `Enter` sends the current message;
- `Ctrl+Enter` inserts a newline and does not submit;
- clicking the Send button continues to work;
- an empty/whitespace-only message is never submitted;
- do not submit while IME composition is active;
- busy/pending guards continue to prevent duplicate or forbidden mutation requests.

Do not add a second keyboard convention that conflicts with this one.

## 3. Pending ChangeSet must become a real preview

### Current defect

The pending panel and Gantt currently use the active browser `PlanState` while only coloring affected tasks. The ChangeSet already contains `proposed_plan`, but the chart does not visually show the proposed dates. This means a user cannot reliably answer the question: “What will my plan look like if I click Apply?”

### Required product behavior

When `pendingChange` exists and its ChangeSet has a valid `proposed_plan`:

- the active plan remains unchanged and remains the source of truth until Apply;
- the Gantt visually previews the proposed schedule before Apply;
- requested/direct changes and transitive dependency impacts must all be understandable;
- Apply commits the proposed result through the existing guarded backend endpoint;
- Cancel removes the preview and returns to the unchanged current plan;
- F5 with a persisted pending ChangeSet restores the same pending preview without applying it.

Do not mutate local `planner.plan` just to render the preview.

## 4. Gantt visual preview model

The preview must clearly distinguish **current** and **proposed** positions.

Preferred visual model:

- unchanged tasks render normally;
- for every task whose dates differ between current `PlanState` and `changeset.proposed_plan`:
  - old/current position remains visible as a subtle ghost/outline;
  - proposed position is shown as a stronger pending/accent bar;
- dependency relationships should remain legible for the proposed schedule;
- the preview must not look as though the changes are already committed;
- after Apply: ghosts disappear and the committed tasks render as ordinary plan bars;
- after Cancel: proposed bars disappear and only current positions remain.

A technically equivalent visual treatment is acceptable if it communicates current → proposed positions at least as clearly. Do not use color alone as the only signal.

Keep Gantt dates read-only; preview is visualization, not drag editing.

## 5. Unified human-readable change summary

The pending panel must explain **all tasks that will change**, not only `proposed_impacts`.

For a mass move such as moving all Sergey tasks by one week, the user should be able to understand at a glance:

- how many tasks were directly requested to move;
- how many additional tasks will move because of dependencies;
- each changed task's current dates and proposed dates;
- whether the change is direct/requested or a dependency consequence.

Example product structure:

> Вы переносите 2 задачи Сергея на 5 рабочих дней. Из-за зависимостей автоматически сдвинутся ещё 2 задачи.

Then one unified list, for example:

- `3 · Backend foundation` — 5 фев → 12 фев — `Запрошенное изменение`
- `5 · Application integration` — 18 фев → 25 фев — `Запрошенное изменение`
- `6 · End-to-end QA` — 23 фев → 2 мар — `Сдвинется из-за зависимости от Application integration`
- `7 · Demo readiness` — 27 фев → 6 мар — `Сдвинется из-за зависимости от End-to-end QA`

Exact wording may differ, but it must be concise Russian product copy and must show all changed tasks.

### Data source / implementation constraint

Use deterministic ChangeSet data, current `PlanState`, and `changeset.proposed_plan` to build the preview. Do not ask the LLM to summarize or calculate the pending schedule.

Use serialized `requested_changes` only as structured deterministic data if needed to distinguish direct targets from transitive impacts; type only the known subset required by the frontend. Do not change backend business semantics merely to make the UI easier.

If direct-vs-dependent classification cannot be safely obtained from existing structured ChangeSet data, stop and report the exact technical gap instead of guessing from task order or array position.

## 6. Remove technical/internal English from pending UI

The user-facing pending panel must not expose backend/internal reason strings such as:

- `TASK-006 must start after TASK-005 finishes`
- validation-engine phrasing;
- internal IDs;
- raw conflict/debug messages when a clear product explanation can be constructed from structured data.

Render dependency consequences from structured fields (`dependency_public_id`, `dependency_name`, current/proposed dates, etc.) using Russian product copy.

Internal English can remain in logs/tests/domain objects; it must not leak into the normal UI.

## 7. Preview correctness scenario for human QA

Use the seed plan and test this scenario after implementation:

1. Restore demo.
2. Ask: `Сдвинь задачи Сергея на неделю вперед`.
3. Before Apply, verify the current plan itself is not mutated.
4. Pending UI should identify two direct Sergey tasks and two downstream affected tasks.
5. Expected proposed start dates:
   - `TASK-003`: `2026-02-05` → `2026-02-12`;
   - `TASK-005`: `2026-02-18` → `2026-02-25`;
   - `TASK-006`: `2026-02-23` → `2026-03-02`;
   - `TASK-007`: `2026-02-27` → `2026-03-06`.
6. The Gantt must visually show each old/current position and each proposed position before Apply.
7. Cancel must restore the original visual schedule exactly.
8. Repeat the scenario and Apply; after Apply the proposed dates become normal committed positions with no ghost bars.

The expected dates above are not a new scheduling rule; they are the concrete acceptance values for the current fixed seed and approved 5-working-day semantics.

## 8. Required regression coverage

At minimum add/update tests for:

- modal relation names render without compact numeric prefixes while the current task header still shows full `TASK-NNN`;
- Enter submits chat;
- Ctrl+Enter inserts a newline without submitting;
- IME composition Enter does not submit;
- pending preview does not mutate active `planner.plan`;
- pending preview derives changed positions by comparing current plan with `proposed_plan`;
- all changed tasks are represented in the pending summary, including directly requested tasks and downstream impacts;
- the seed Sergey +1 week scenario produces the four expected proposed start dates listed above;
- Cancel removes pending preview and preserves original dates;
- Apply commits the proposed plan through the existing apply endpoint;
- persisted pending ChangeSet restores preview after reload;
- normal no-pending Gantt rendering remains unchanged;
- no internal UUID or raw internal English dependency text is displayed in the standard pending UI.

Run the full backend suite, frontend tests, lint, TypeScript/build, dependency/audit checks already used by the project, and `git diff --check`.

## Locked scope

Do not:

- change approved scheduling/business rules;
- change TASK-ID semantics;
- rewrite ChangeSet final-state validation;
- rewrite MCP/Qwen architecture;
- add persistence/database/auth;
- add drag/resize editing;
- begin Excel redesign beyond preserving existing behavior;
- begin Docker/deployment/delivery;
- redesign the whole application shell again.

## Human QA gate after implementation

Stop after implementation and checks. Do not begin delivery.

Human QA order:

1. Open TASK-007 modal and verify its own full ID is clear while related task names show no numeric prefixes.
2. Verify Enter sends and Ctrl+Enter creates a newline.
3. Restore demo and run `Сдвинь задачи Сергея на неделю вперед`.
4. Verify the pending summary clearly explains all four changed tasks and distinguishes direct vs dependency-driven changes.
5. Verify the Gantt shows current → proposed positions before Apply rather than only recoloring current bars.
6. Cancel and confirm the visual schedule returns exactly to the original plan.
7. Repeat and Apply; confirm the proposed schedule becomes the committed normal schedule.
8. F5 while pending and confirm preview/pending state restores without applying.

Only after this passes should the remaining Iteration 04 QA continue.

## Handoff

After implementation:

- create one rework commit;
- leave the worktree clean;
- report exact files changed and verification results;
- call out any deviation or product/business ambiguity before proceeding;
- stop for human QA;
- no delivery/deployment work.