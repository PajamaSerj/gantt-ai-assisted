# Iteration 04.5 — Gantt timeline polish and direct manipulation

Status: READY
Depends on: Iteration 04 accepted after Rework 03
Source of truth: `docs/AI_Gantt_Planner_Master_Brief_v1.3.md`

## Goal

Upgrade the Gantt itself from a read-only visualization into a polished interactive planning surface while preserving the existing deterministic scheduling and ChangeSet architecture.

This is an enhancement iteration between UI Integration and Delivery. It does not change the approved product/business model. AI, Excel and direct mouse interaction must all converge on the same deterministic planning engine.

## Product principles

- The Gantt is not allowed to mutate PlanState directly.
- Drag/resize are user input methods, not alternate business logic.
- Every direct manipulation must be converted into a deterministic backend ChangeSet before PlanState changes.
- Existing dependency rules, working-day rules, final-state validation, confirmation rules, pending lock and transitive impact rules remain authoritative.
- If a direct edit is safe and auto-applicable, it may apply immediately after backend validation.
- If it has conflicts, date normalization or downstream impacts requiring confirmation, show the same pending preview/Apply/Cancel flow already used by AI and import.
- While a pending ChangeSet exists, additional plan mutations through AI, import, drag or resize are blocked.

---

## 1. Timeline bounds and initial viewport

The timeline must be derived from the actual current plan, not from a large generic Frappe padding range.

Let:
- `plan_start = min(task.start_date)`
- `plan_end = max(task.end_date)`

Use a small meaningful visual buffer around the plan:

- Day view: approximately 2–3 calendar days before `plan_start` and after `plan_end`.
- Week view: one complete calendar week before the week containing `plan_start`, and one complete calendar week after the week containing `plan_end`.
- Month view: at most the previous calendar month before the plan and the next calendar month after it.

Acceptance criteria:
- The user cannot scroll through a large empty month before a project that begins in February.
- The first task is never clipped at the left edge on initial load, Restore demo, import or view-mode change.
- The final task has a small breathing space to the right.
- The bounds are recomputed when the plan is replaced/imported or its min/max dates materially change.
- Keep `infinite_padding: false`.

Add a subtle non-interactive `Начало проекта` marker at `plan_start` if this can be implemented cleanly without fighting Frappe internals. It must not add visual noise.

---

## 2. Human calendar rendering

### Week view

Week buckets must align to the Russian/ISO convention Monday–Sunday, rather than arbitrary seven-day blocks based on the Frappe range origin.

Examples of desired labels:

- `26 янв. – 1 фев.`
- `2–8 фев.`
- `23 фев. – 1 мар.`

Do not display confusing ranges such as `27 - 02 февр.` when the bucket is intended to represent a calendar week.

### Day view

- Keep Russian month names and concise human-readable dates.
- Subtly shade Saturday/Sunday columns so the relationship between workday duration and calendar width is understandable.
- Do not change backend working-day calculations; this is visualization only.

### Month view

- Keep concise Russian month labels.
- Do not introduce another date calculation layer that could disagree with backend dates.

---

## 3. Drag and drop — move task

Enable horizontal dragging of a task bar as a deliberate direct planning action.

User intent:

`drag TASK-X to another horizontal date position` = request to change that task's start date only.

Rules:

- Dragging never creates, removes or changes dependencies.
- Dragging never performs implicit resource optimization or pull-left of unrelated tasks.
- The backend remains responsible for weekend normalization, dependency validation, cycles, downstream impacts and confirmation requirements.
- A task may be visually dragged to a calendar position, including a weekend; backend rules decide whether normalization/confirmation is needed.
- Do not persist the temporary Frappe-mutated geometry as PlanState.

Interaction lifecycle:

1. User starts dragging a bar.
2. Show normal drag affordance/cursor.
3. On drop, capture task public/internal ID and intended new calendar start date.
4. Immediately treat the local visual result as provisional only.
5. Send a deterministic direct-edit prepare request to backend.
6. Backend builds one ChangeSet using the same domain services as AI prepare tools.
7. Result:
   - auto-applicable: apply through guarded backend logic and render returned PlanState;
   - confirmation required: render existing pending preview with current ghost positions and proposed positions, then Apply/Cancel;
   - invalid/error: restore the current authoritative PlanState and show a concise human-readable message.

Do not let the task remain visually moved while the backend has rejected the edit.

---

## 4. Resize — change duration

Enable resizing the **right edge** of a task bar to change `duration_workdays`.

Do not expose left-edge resize in this iteration. Left-edge resize simultaneously implies a start-date and duration change and is too ambiguous for the current product model; moving start date is handled by drag.

Rules:

- Right-edge resize changes duration only.
- Resulting duration must always be a positive integer number of workdays.
- The intended visual end position is input; deterministic backend converts/validates it against working-day rules and prepares the corresponding duration change.
- Backend recalculates task end date and all downstream dependency impacts.
- Same auto-apply vs confirmation preview lifecycle as drag.
- Progress resize remains disabled; progress is not part of MVP.

Acceptance examples:

- Extending a 3-workday task to 5 workdays updates duration to 5 and recalculates end date deterministically.
- If the longer duration pushes successors, the user sees those successors in the same pending preview before applying.
- Cancel returns the complete diagram to the authoritative pre-resize PlanState.

---

## 5. Backend/API integration

Add the smallest explicit deterministic API surface required for direct Gantt edits. Technical endpoint shape is implementation-owned, but it must not route through the LLM or MCP model-facing path.

Preferred conceptual inputs:

### Move

- current `PlanState`
- task identifier
- intended new start date

### Resize

- current `PlanState`
- task identifier
- intended new visual end date or equivalent deterministic resize payload

The backend must translate these inputs into existing domain ChangeSet operations and reuse current validation/application services rather than duplicating scheduling logic.

Do not create a second scheduling engine in frontend.

Do not expose `apply_changes` to the LLM as part of this work.

---

## 6. Direct manipulation UX

- Use clear move cursor/hover affordance for draggable bars.
- Show only the right resize handle.
- Do not make bars feel accidentally draggable when the user is trying to click to open details; distinguish click from drag using normal interaction thresholds.
- A simple click still opens the read-only task modal.
- While backend is preparing a direct edit, provide a lightweight immediate busy indication without freezing the rest of the page.
- Block conflicting plan mutations while direct-edit preparation/apply is in flight.
- Preserve current AI drawer behavior and Gantt side-by-side layout.
- Direct manipulation must work with AI drawer both closed and open.

---

## 7. Pending preview reuse

Do not invent a second preview component for mouse edits.

Direct drag/resize confirmation must reuse the current pending ChangeSet UX:

- all directly requested and dependency-shifted tasks are summarized;
- current position is visible as ghost/outline;
- proposed position is visually distinct;
- concise Russian explanations;
- `Применить всё` / `Отменить`;
- active PlanState remains unchanged until apply.

The source of the pending change may be direct manipulation, but the semantic behavior must match chat/import pending changes.

---

## 8. Tests

Add regression coverage at minimum for:

- timeline range derived from plan and no excessive empty history;
- Week view Monday–Sunday alignment/formatting helpers;
- Day weekend visualization helper/class mapping;
- task click still opens modal when no drag occurs;
- drag emits one deterministic move preparation request and never directly mutates stored PlanState;
- safe drag auto-applies returned backend PlanState;
- drag with downstream impact produces pending ChangeSet and does not mutate active PlanState;
- cancel after drag preview restores/keeps original PlanState;
- right-edge resize changes duration through backend ChangeSet;
- resize with downstream impact uses pending preview;
- left-edge resize is unavailable;
- pending ChangeSet disables drag and resize;
- provider/LLM is not called for direct manipulation;
- existing Iteration 01–04 regression suites still pass.

Run:

- targeted backend tests;
- full backend suite;
- frontend Vitest suite;
- frontend lint;
- TypeScript/Vite production build;
- `npm audit`;
- `git diff --check`.

---

## 9. Human QA

Human QA is mandatory before acceptance.

Minimum manual scenarios:

1. Restore demo; confirm first task is fully visible and there is only a small useful timeline buffer before/after the project.
2. Check Day/Week/Month labels; Week boundaries are Monday–Sunday and Day weekends are visually recognizable.
3. Drag terminal TASK-007 later by one working day; safe edit should settle to backend-approved dates.
4. Drag a predecessor so successors are impacted; active plan must remain unchanged while the pending preview shows old and proposed positions.
5. Cancel; all tasks return/remain at current authoritative positions.
6. Repeat and Apply; proposed dates become active.
7. Resize a task from its right edge; verify duration and downstream consequences.
8. Verify a plain click still opens task details and does not accidentally drag.
9. Open AI drawer and repeat basic drag/resize; layout and scroll remain usable.
10. F5 after applied direct edit; localStorage retains the applied PlanState.

---

## Locked scope / non-goals

Do not add:

- vertical task reordering;
- left-edge resize;
- progress editing;
- direct dependency creation by drawing arrows;
- resource leveling;
- milestones;
- status/priority editing;
- multi-select drag;
- undo/redo history;
- database/auth;
- delivery/deployment work.

Do not rewrite the current ChangeSet engine, MCP architecture, Excel flow or AI orchestration unless a concrete integration defect requires a minimal compatible correction.

## Completion

Create one implementation commit, leave the worktree clean, report checks and stop for Human QA. Do not start Delivery/deployment.