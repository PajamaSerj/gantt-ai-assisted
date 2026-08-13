# Iteration 04 — UI Integration

**Status:** READY  
**Depends on:** Iteration 03 fully ACCEPTED (`18c218b1835b5fe2427d9d14c2f63bfab69630d2` + successful live Qwen/MCP smoke test)  
**Source of truth:** `docs/AI_Gantt_Planner_Master_Brief_v1.3.md`

## Goal

Turn the existing backend/domain foundation into the reviewer-facing MVP application: seeded interactive Gantt as the main screen, AI drawer, deterministic Excel import/export, confirmation UI, task modal, browser persistence and reset flow.

The iteration must integrate the already accepted backend contracts. Do not redesign scheduling, ChangeSet, MCP or AI semantics.

## Required scope

### 1. Frontend state and startup

- Read `AGENTS.md`, Master Brief and this brief before changes.
- Keep `PlanState` in React/browser state; backend remains stateless.
- On first open when localStorage has no saved plan: call `GET /api/seed`, save the returned PlanState locally and render it.
- On F5/reopen in the same browser: restore the current PlanState from localStorage instead of replacing it with seed.
- Persist the minimal AI conversation context required by the existing stateless `/api/chat` contract.
- Persist pending ChangeSet/UI state only as required to safely continue an explicit confirmation flow.
- Do not add Redux or another global-state framework unless a concrete implementation blocker requires it.

### 2. Main Gantt screen

- Gantt is the visual hero and occupies most of the page.
- Use Frappe Gantt as visualization only; deterministic backend remains the scheduling source of truth.
- Render seeded/current tasks, dates and Finish-to-Start dependencies.
- Direct date mutation through Gantt drag/resize must be disabled/read-only.
- Frappe must not automatically move dependent tasks (`move_dependencies = false` or equivalent for the installed version).
- Support navigation/scroll and an appropriate view scale control if the library supports it cleanly.
- On first seed render and after Restore demo, position the Gantt at the plan start so the fixed seed dates are immediately visible.
- Approved backend changes must immediately re-render the Gantt.
- Highlight affected/conflicting tasks when a pending ChangeSet provides that information.

### 3. Task modal

- Clicking/selecting a task opens a read-only modal.
- Show: public TASK-ID, name, description, assignee, duration, start date, end date, predecessors and successors.
- Never expose internal UUIDs to the user.
- No edit controls in the modal for MVP.

### 4. AI assistant UI

- Keep AI continuously available through a compact button/corner control; do not reserve a permanent large sidebar.
- Clicking it opens a right-side or floating drawer/panel.
- Primary prompt: `Что хотите сделать с задачами?`
- Send current PlanState + message + conversation context to `POST /api/chat`.
- Handle existing outcomes:
  - `applied`: replace local PlanState with returned PlanState, persist and re-render immediately;
  - `clarification_required`: show the clarification, preserve returned conversation context and unchanged PlanState;
  - `confirmation_required`: show explanation/impacts/options and store the returned pending ChangeSet without mutating PlanState.
- Browser/UI must preserve UTF-8 Russian input/output correctly. The PowerShell console encoding issue seen during the live smoke test is not an application behavior to reproduce.
- Do not send the whole PlanState directly to an LLM from React; React talks only to FastAPI.

### 5. Pending ChangeSet lifecycle

While a pending ChangeSet exists:

- block new AI mutation submission;
- block Excel Replace/Append and other plan-changing actions;
- keep read-only Gantt/task modal available;
- clearly require the user to finish Apply/Cancel first.

Apply flow:

- call `POST /api/changesets/apply` with current PlanState, pending ChangeSet and the selected backend-supported option;
- use only options actually returned/supported by the API; do not invent client-side resolution logic;
- on success replace/persist PlanState, clear pending state and re-render/highlights;
- show backend validation errors without partially applying client-side changes.

Cancel clears the pending confirmation state without changing PlanState.

### 6. Excel import UX

Provide one compact Excel control/menu:

- Import
- Export

Also provide a paperclip/attachment entry point in the AI panel.

Both import entry points must use the same deterministic `POST /api/import` flow. Excel bytes/content must never be sent to Qwen/LLM.

Import requirements:

- `.xlsx` only;
- let the user choose Replace or Append;
- Replace asks for plan start date;
- Append asks for minimum allowed start date;
- show all structural/row/graph validation errors returned by backend;
- if import returns confirmation-required impacts, route them through the same pending/confirmation UX rather than applying anything early;
- successful import replaces the browser PlanState with the returned result and persists it.

Do not implement client-side Excel parsing/business validation that duplicates the backend.

### 7. Excel export UX

- Call `POST /api/export` with the current PlanState.
- Download the returned `.xlsx` through the browser with a sensible filename.
- Do not rebuild export rows client-side.

### 8. Restore demo

Provide compact action: `↺ Восстановить демо-данные`.

After user confirmation:

1. cancel any pending ChangeSet/UI confirmation state;
2. call `GET /api/seed`;
3. replace and persist PlanState;
4. clear AI conversation context;
5. clear impacts/conflict highlighting;
6. render original seed;
7. position Gantt at plan start.

## UX quality bar

This is a test-task demo, not an internal debug shell.

- One coherent page with clear hierarchy and no developer-only controls in the primary UI.
- Gantt must remain visually dominant.
- AI drawer and Excel controls must be easy to discover without crowding the chart.
- Loading, disabled, empty/error and pending-confirmation states must be understandable.
- Do not overbuild design-system abstractions or add heavy UI frameworks unless already present/clearly justified.
- Desktop reviewer flow is primary; avoid obvious breakage at common laptop widths.

## Integration / regression expectations

Add frontend tests where practical for state/contract behavior. At minimum verify through automated tests and/or deterministic component/service tests:

- first load fetches seed and subsequent reload restores saved PlanState;
- applied chat response updates/persists plan;
- clarification keeps plan unchanged and preserves conversation context;
- confirmation stores pending ChangeSet and blocks mutations;
- Apply uses `/api/changesets/apply`; Cancel does not mutate plan;
- Restore demo clears plan/transient AI state and restores seed;
- task modal maps predecessor/successor display without UUID leakage;
- Excel toolbar import and AI attachment both route to `/api/import`;
- export routes current PlanState to `/api/export`;
- Russian UTF-8 request/response text is preserved by frontend API calls;
- Gantt cannot mutate dates locally and dependent-task auto-movement is disabled.

Run the full backend suite as regression, frontend lint/type/build/tests, and `git diff --check`.

## Human QA required before acceptance

After implementation, run the app locally and stop for human QA. The reviewer/user should be able to demonstrate at least:

1. initial seeded Gantt visible immediately;
2. task click opens correct read-only modal;
3. Russian AI command that safely changes a task and immediately updates the Gantt;
4. an ambiguous/impactful command that produces clarification or confirmation without premature mutation;
5. Excel import from both the Excel control and AI attachment route;
6. Excel export download;
7. F5 persistence;
8. Restore demo returning to the fixed seed.

Do not declare Iteration 04 accepted based only on unit tests or build success; visual/interaction QA is mandatory.

## Locked scope / out of scope

- Do not change approved product/business rules in the Master Brief.
- Do not redesign MCP transport, Qwen provider, ChangeSet engine, Excel parser/scheduler or domain model unless an actual integration defect requires a narrowly scoped fix; report such a defect explicitly.
- No database/auth/users/roles.
- No editable task modal.
- No Gantt drag/resize scheduling.
- No resource-capacity planning, status/progress/priority/milestones, holiday calendar or automatic optimization.
- No AI parsing of Excel content.
- No Docker/Yandex deployment, public URL, sample workbook/demo capture/final Roadmap packaging in this iteration; those belong to delivery iteration.
- Do not create a second frontend scheduling engine.

## Handoff

After implementation:

- run required checks;
- remove generated/temporary artifacts;
- create one clear Iteration 04 commit;
- leave the worktree clean;
- report changed files, checks, implementation notes and any deviations/blockers;
- provide exact local run steps for human QA;
- stop before deployment/delivery work.
