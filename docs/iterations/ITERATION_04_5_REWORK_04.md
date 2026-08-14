# Iteration 04.5 — Rework 04: Same-row Change Preview

Status: REWORK  
Base commit: `73f5a2180bfd6c055bf31b0c2e16eb1551709697`  
Source of truth: `docs/AI_Gantt_Planner_Master_Brief_v1.3.md`

## Human QA finding

The current pending ChangeSet preview duplicates one logical task into separate vertical Gantt rows:

- current position as a dashed `Сейчас` task;
- proposed position as an orange `После применения` task.

This is semantically misleading for a Gantt chart. The vertical axis represents different tasks, so users can interpret the preview as vertical task movement, reordering, or duplicate tasks. In reality only dates or duration change on the horizontal time axis.

## Goal

Replace duplicated preview rows with a **same-row before/after overlay**.

For every affected task:

- the authoritative current task stays in its original row and position;
- the proposed position is rendered in the same row;
- a horizontal visual connection explains the date movement;
- compact labels explain the delta and reason;
- the number and order of Gantt rows do not change while preview is open.

## Approved visual direction

Conceptual target:

```text
same task row

[current blue bar]  Текущее  - - - - ->  [orange proposed bar]  +5 раб. дней
                                               После применения
                                               сдвиг из-за зависимости
```

For a leftward move, the connector points left:

```text
[orange proposed bar]  <- - - -  Текущее  [current blue bar]
```

For resize, both states remain in the same row and share the same start when only duration changes:

```text
[current blue bar---------]
[current start | orange proposed outline-------------------]  3 → 5 раб. дней
```

The final implementation must follow the current product palette and spacing; this is not a redesign of the whole Gantt.

## Locked architecture and behavior

Do not change:

- backend scheduling rules;
- ChangeSet structure or validation;
- direct-edit API;
- AI/MCP behavior;
- Excel flows;
- current drag/resize semantics;
- weekend snapping;
- dependency-bound handling;
- pending Apply/Cancel lifecycle;
- stable direct-edit rendering delivered in Rework 03.

The backend `proposed_plan` remains authoritative. This rework changes only how the pending result is visualized.

## Required UX

### 1. One real task equals one Gantt row

While preview is open:

- the chart must contain exactly one row per task in the current PlanState;
- current and proposed states of the same task must share the same vertical row;
- do not create Frappe pseudo-tasks such as `current-*` and `proposed-*` that occupy separate rows;
- do not increase chart height because of preview;
- task order must remain unchanged.

For the seven-task demo plan, preview must still display seven rows, not eleven or another expanded count.

### 2. Current state

For an affected task:

- keep the current task bar in its normal blue style;
- keep the real task number and name on the current bar as today;
- optionally add a compact `Текущее` chip next to the affected current bar when space allows;
- current state remains visually authoritative until Apply.

Unaffected tasks remain unchanged.

### 3. Proposed state overlay

Render the proposed state as a custom overlay in the **same row**:

- orange outline;
- light translucent orange fill;
- same corner radius and height family as normal bars;
- text `После применения` inside when there is enough width;
- if the bar is too narrow, keep the bar readable without forcing clipped text and place the meaning in a nearby chip/label;
- overlay must use `pointer-events: none`.

Prefer a dedicated SVG overlay/custom SVG elements aligned to the existing Frappe row geometry. Do not simulate the overlay by adding another Frappe task row.

### 4. Horizontal movement connector

For a move where current and proposed positions differ:

- draw a thin dashed horizontal connector between the states;
- add an arrowhead pointing from current to proposed;
- support both rightward and leftward moves;
- the connector must stay within the same row;
- it must not look like a dependency arrow between tasks.

When current and proposed bars overlap, do not force a long connector. Preserve a visible orange outline/segment and use the delta label.

### 5. Delta and reason labels

Show compact product-language labels near the proposed state.

Examples:

- `+5 раб. дней`;
- `−2 раб. дня`;
- `3 → 5 раб. дней` for duration changes;
- `Запрошенное изменение` for the directly edited task;
- `Сдвиг из-за зависимости` for propagated tasks.

Rules:

- calculate the displayed workday delta consistently with existing deterministic calendar logic or already prepared preview data;
- avoid technical backend text;
- labels must not overlap adjacent rows;
- labels must remain visible near left/right timeline boundaries;
- adapt the existing edge-placement helper or replace it with an equivalent same-row overlay placement mechanism.

### 6. Move scenarios

For a directly requested move:

- current blue bar stays in place;
- orange proposed bar appears at proposed dates in the same row;
- connector points in the correct direction;
- label shows signed workday delta;
- reason is `Запрошенное изменение`.

For a dependency-propagated move:

- use the same same-row visualization;
- reason is `Сдвиг из-за зависимости`;
- do not imply that the user directly dragged that downstream task.

### 7. Resize scenarios

For a duration change:

- current and proposed duration must be comparable in the same row;
- start date stays aligned when only duration changes;
- orange proposed outline shows the new end position;
- label uses the duration form, for example `3 → 5 раб. дней`;
- if proposed duration is shorter, the orange proposed boundary must still be clear inside the current blue range;
- do not render the resize as a vertical duplicate row.

If a direct resize also causes downstream moves, each downstream task receives its own same-row move overlay.

### 8. Timeline bounds and responsiveness

The timeline must consider both current and proposed dates so overlays are not clipped.

Preserve the accepted bounded timeline behavior:

- no infinite empty range;
- short projects fill available width;
- long projects scroll normally;
- AI drawer open/close remains responsive;
- Day, Week, and Month modes remain valid;
- same-row overlays remain aligned after view-mode changes and container resize.

### 9. Pending interaction lock

While preview is open:

- all task drag and resize interactions remain blocked;
- overlay elements do not capture pointer events;
- user must Apply or Cancel before initiating another mutation.

### 10. Apply and Cancel

Apply:

- overlay disappears;
- proposed dates become normal blue authoritative bars;
- no full-chart collapse/flicker;
- dependency lines reconcile correctly;
- no ghost labels remain.

Cancel:

- all overlays, connectors, chips, and delta labels disappear;
- current bars remain exactly where they were;
- no partial proposed geometry survives;
- chart row count and scroll position remain stable.

## Existing top summary panel

Keep the upper `Изменения ещё не применены` panel as the precise textual summary.

It continues to show:

- task number/name;
- old dates → proposed dates;
- direct vs dependency reason;
- Apply/Cancel controls.

The Gantt overlay is the spatial explanation; the upper panel is the exact data explanation. Do not remove either.

## Technical direction

The current preview implementation builds duplicated Frappe tasks. Replace that preview rendering path.

Recommended contained approach:

1. Render the authoritative current PlanState as normal Frappe tasks only.
2. Build a preview geometry model from current plan + `changeset.proposed_plan`.
3. Resolve each affected task's existing row/bar geometry.
4. Render proposed rectangles, same-row connectors, and labels in a dedicated SVG overlay group/layer.
5. Recalculate overlay geometry after initial preview render, view-mode change, container resize, horizontal scroll, and Apply/Cancel transition.
6. Keep overlay rendering independent from direct-edit busy state so Rework 03 stability is preserved.

Do not introduce a new chart library or a new state-management framework.

## Accessibility

- the textual summary panel remains the accessible source of exact before/after information;
- decorative overlay SVG elements may be `aria-hidden=true`;
- do not expose duplicated pseudo-task names to screen readers;
- maintain keyboard access to Apply/Cancel.

## Regression coverage

Add focused tests proving at minimum:

1. A pending preview for the seven-task demo still renders seven logical Gantt rows.
2. No duplicated Frappe preview tasks are created for current/proposed states.
3. Current and proposed geometry for one task resolves to the same row/Y coordinate.
4. Rightward move renders a right-pointing same-row connector.
5. Leftward move renders a left-pointing same-row connector.
6. Direct and dependency-propagated tasks receive different reason labels.
7. Resize preview shares the current start and visualizes the proposed end/duration.
8. Overlapping current/proposed ranges remain visually distinguishable.
9. Edge labels remain within the visible timeline/container.
10. Apply removes overlay and makes proposed dates authoritative.
11. Cancel removes overlay without mutating the current PlanState.
12. Pending preview still blocks drag/resize.
13. Existing weekend, dependency-bound, stable-rendering, click-vs-drag, AI preview, and persistence tests continue to pass.

Unit tests do not replace Human QA of visual clarity.

## Human QA scenarios

After implementation, record a GIF covering:

1. Move TASK-005 right so TASK-006 and TASK-007 shift; verify one row per task, same-row states, labels, and Apply.
2. Repeat and Cancel.
3. Move a task left and verify a left-pointing connector.
4. Resize TASK-005 and verify same-row duration overlay plus downstream moves.
5. Open/close AI drawer and switch Day/Week/Month while preview is open.
6. Create a preview through AI and confirm the same visualization is reused.

## Acceptance criteria

Rework is accepted only when:

- vertical task duplication is eliminated;
- preview never implies vertical movement or task reordering;
- current and proposed dates are immediately comparable on one row;
- direct versus dependency impact is understandable without reading backend details;
- Apply/Cancel remain correct;
- drag/resize and AI share the same preview visualization;
- no collapse, flicker, clipped labels, extra rows, or stale overlays occur;
- the worktree is clean after one rework commit.

## Verification

Run:

- targeted preview geometry/component tests;
- full frontend test suite;
- frontend lint;
- TypeScript / production build;
- full backend suite;
- dependency check;
- `git diff --check`.

Create one rework commit and stop for Human QA. Do not start Iteration 05, delivery, or deployment.
