# Iteration 04.5 — Rework 03: Stable direct-edit rendering

Status: REWORK
Base commit: `f712e0f53132542705d5e53678c320fe9e156233`
Source of truth: `docs/AI_Gantt_Planner_Master_Brief_v1.3.md`

## Finding

Human QA of real drag/resize interactions shows a visible full-Gantt collapse/flicker after releasing a safe direct edit. During the backend round-trip the entire chart is rebuilt and task bars briefly collapse into narrow vertical fragments before the authoritative state is rendered again.

The current direct-edit architecture is otherwise acceptable and must remain locked:

- drag/resize create a direct-edit intent;
- deterministic backend prepares/applies a ChangeSet;
- AI is not involved;
- safe edits can auto-apply;
- impacted edits use the existing pending preview;
- weekend snapping and dependency-bound edge cases from Rework 02 remain unchanged.

## Root cause to address

`GanttChart` currently performs chart-wide refresh/reconstruction around direct-edit completion. In particular:

- `finishInteraction()` refreshes the whole chart back to authoritative tasks before the backend result is known;
- `interactionBusy` / interaction state changes participate in the chart construction lifecycle, causing another teardown/rebuild while the request is in flight;
- the authoritative plan response can trigger a further full reconstruction.

This produces a visible collapse/flicker even for a safe single-task drag or resize.

## Required correction

Preserve a stable Gantt canvas during direct-edit round-trips.

### Safe drag / resize UX

For a safe direct edit:

1. User drags or resizes one bar.
2. On mouse/touch release, the chart must not blank, collapse, or reconstruct all bars.
3. The edited bar may remain in its provisional visual position while the deterministic backend validates the request, or be restored using a targeted/non-destructive update. Choose the simpler technically reliable implementation.
4. Other task bars and dependency lines must stay visually stable while the request is pending.
5. Prevent a second drag/resize while the request is pending.
6. If backend returns `APPLIED`, reconcile to the authoritative returned PlanState without a visible full-chart collapse.
7. If backend returns `CONFIRMATION_REQUIRED`, transition directly into the existing ghost/proposed pending preview.
8. If backend returns `INVALID` or the request fails, restore the authoritative current plan without leaving the provisional bar behind.

Do not mutate browser PlanState optimistically. The backend result remains authoritative.

### Lifecycle constraint

Transient `interactionBusy` changes must not by themselves destroy and reconstruct the Frappe Gantt instance.

Use refs / event guards / host interaction blocking or another contained approach so busy-state changes can disable interaction without forcing the main chart construction effect to tear down the canvas.

A full reconstruction is acceptable only when the actual task/timeline/preview data requires it, and even then the rendered transition must not show the narrow-bar collapse seen in QA.

### Resize affordance

Keep the left resize handle disabled.

Make the allowed right-edge resize affordance discoverable on hover without adding permanent visual clutter. Cursor and/or a subtle handle is sufficient.

### Preserve all Rework 02 behavior

Do not regress:

- rightward weekend drag snaps to next working day;
- leftward weekend drag snaps to previous working day;
- right-edge resize uses direction-aware working-day snapping;
- dependency-bound no-op move returns a concise message without pending preview;
- proposed labels remain visible near timeline edges;
- pending ChangeSet blocks new direct edits;
- click opens modal, drag/resize do not accidentally open modal.

## Regression coverage

Add focused tests proving at minimum:

- changing only the transient direct-edit busy state does not require/recreate a new Gantt instance;
- safe drag preserves one stable chart instance through request start until authoritative result reconciliation where technically feasible;
- invalid/error result restores authoritative task geometry and leaves no provisional state;
- confirmation result transitions into the existing pending preview without first rendering a collapsed/empty chart;
- right-edge resize remains available and left-edge resize remains disabled;
- all existing Rework 02 weekend/dependency tests continue to pass.

Do not claim unit tests alone prove animation smoothness. Human QA with a short screen recording/GIF remains required.

## Locked scope

Do not change scheduling rules, ChangeSet semantics, AI/MCP behavior, Excel flows, seed content, deployment, or the approved timeline model.

Do not replace Frappe Gantt or introduce a new state-management/rendering framework.

## Verification

Run:

- targeted frontend interaction tests;
- full frontend test suite;
- frontend lint;
- TypeScript / production build;
- full backend suite;
- dependency check;
- `git diff --check`.

Create one rework commit, leave the worktree clean, report checks, and stop for Human QA. Delivery/deployment must not start.
