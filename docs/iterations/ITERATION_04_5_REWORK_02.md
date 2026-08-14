# Iteration 04.5 — Rework 02: Direct manipulation edge cases

Status: REWORK
Base commit: `936348de4326c7588265b1f2365f598d14ecb399`
Source of truth: `docs/AI_Gantt_Planner_Master_Brief_v1.3.md`
Parent iteration: `docs/iterations/ITERATION_04_5_GANTT_INTERACTION.md`

## Finding

Human QA confirmed that the direct-manipulation architecture is correct, but several mouse interaction edge cases are not product-safe yet.

Current flow correctly routes drag/resize through the deterministic backend and ChangeSet, but the frontend sends raw calendar dates from Frappe. This makes a one-step drag from Friday land on Saturday first, after which backend weekend normalization creates an unnecessary confirmation preview. Similar ambiguity exists for right-edge resize. A drag earlier than the earliest valid dependency start can also produce a noisy no-op preview instead of a clear explanation.

Do not redesign the direct-edit architecture. Fix only these interaction semantics and related presentation.

## Required corrections

### 1. Direction-aware working-day snap for drag

For direct mouse drag only, convert the provisional Frappe start date to a valid working-day target before calling `/api/direct-edits/prepare`.

Rules:

- moving right and landing on Saturday/Sunday -> snap to the next working day;
- moving left and landing on Saturday/Sunday -> snap to the previous working day;
- landing on a working day -> keep that date;
- backend remains authoritative and must still validate the resulting date;
- do not change the existing AI / explicit-date semantics: an explicitly requested weekend date may still use the existing normalization + confirmation behavior.

Example from seed:

- TASK-007 starts Friday 2026-02-27;
- dragging one calendar step right must produce direct target 2026-03-02;
- because TASK-007 has no downstream impact and the final target is valid, this should be AUTO_APPLICABLE / APPLIED without a weekend normalization confirmation.

### 2. Direction-aware working-day snap for right-edge resize

Apply equivalent mouse-specific snapping to the provisional right edge before converting it to duration.

Rules:

- extending the right edge and landing on Saturday/Sunday -> snap to the next working day;
- shortening the right edge and landing on Saturday/Sunday -> snap to the previous working day;
- start_date never changes during resize;
- left-edge resize remains disabled;
- backend still owns duration calculation, schedule validation, downstream impact calculation and apply authorization.

Do not directly mutate `duration_workdays` in frontend.

### 3. Graceful handling of invalid / no-op dependency drag

If direct drag tries to place a task earlier than the earliest valid Finish-to-Start start and deterministic validation effectively keeps the task at its current authoritative position, do not show a large confirmation preview for a no-op.

Expected UX:

- restore the authoritative bar position;
- show one short human-readable message such as:
  `Задача не может начинаться раньше завершения TASK-006 · Сквозное тестирование.`
- no pending ChangeSet should remain when there is no actual proposed change;
- do not silently change dependencies;
- do not pull any task left automatically.

If the attempted drag creates a real valid proposed change plus downstream impacts, keep the normal pending ChangeSet preview flow.

### 4. Proposed-bar label clipping

In pending Gantt preview, labels for proposed bars near the right edge must remain readable.

- do not allow `После применения: ...` labels to be clipped by the timeline/container edge;
- if there is insufficient space to the right, render/position the label inside the bar or to the left;
- preserve current ghost/current vs proposed visual distinction;
- do not reintroduce unbounded timeline padding just to make labels fit.

### 5. Preserve locked behavior

Keep unchanged:

- direct edits go through deterministic backend / ChangeSet;
- no LLM call for drag or resize;
- pending ChangeSet blocks new plan mutations;
- stale PlanState response protection;
- left resize disabled;
- drag preserves duration;
- resize changes duration only;
- downstream impacts require the existing consolidated preview;
- no implicit pull-left optimization;
- current bounded timeline and responsive sizing from Rework 01;
- Russian demo seed and full relation IDs in modal.

## Required regression coverage

Add targeted tests for at least:

1. drag right from Friday to weekend -> snapped to next Monday before direct-edit API request;
2. drag left onto weekend -> snapped to previous Friday;
3. drag on a working day -> unchanged target;
4. right-edge resize extension onto weekend -> next working day;
5. right-edge resize contraction onto weekend -> previous working day;
6. resize still keeps start date unchanged and left handle disabled;
7. dependency-bound no-op drag does not leave a pending ChangeSet and returns a concise explanation;
8. a real downstream-impact drag still returns the normal pending preview;
9. direct drag/resize path still does not call the AI provider;
10. existing backend + frontend regression suites remain green.

Do not describe fake/unit tests as proof of visual drag quality; human QA will verify cursor feel, snap behavior and preview label placement.

## Human QA after implementation

Run in this order after Restore demo:

1. TASK-007: drag one step right from Friday 27 Feb -> should land on Monday 2 Mar and apply without confirmation.
2. TASK-007: drag one step left onto weekend-equivalent direction -> should snap to previous working day if valid; if dependency constraint blocks it, show concise dependency message and no pending preview.
3. TASK-005: drag right enough to affect TASK-006/TASK-007 -> normal ghost/proposed pending preview, Cancel and Apply both work.
4. TASK-007: extend right edge across weekend -> working-day-aware resize with unchanged start.
5. TASK-005: extend right edge enough to affect successors -> normal pending preview.
6. Verify proposed labels remain fully visible near the right edge.
7. Click after drag/resize must not accidentally open modal.

## Verification

Run targeted tests, full backend suite, frontend tests, lint, TypeScript/production build and `git diff --check`.

Create one rework commit, leave worktree clean and stop for Human QA. Do not start delivery/deployment.
