# Iteration 04.5 — Rework 06: Collision-free labels and gesture intent

Status: REWORK  
Base commit: `1f2beec5b862058adf5ffef1bbf6539b8981ccfc`  
Source of truth: `docs/AI_Gantt_Planner_Master_Brief_v1.3.md`

## Human QA findings

The minimal same-row preview direction is accepted, but Human QA found two remaining product defects.

### 1. Task text collides with preview geometry

Frappe may place a task label outside a short current bar. During pending preview, the proposed orange outline and same-row connector can occupy the same horizontal space. The task name then overlaps the connector or proposed outline, or visually blocks them.

The preview must never allow task text and preview geometry to cover each other.

### 2. A drag attempt can open the task modal

The current click suppression is tied mainly to `on_date_change` and a short timeout. This is insufficient:

- a small pointer movement may not change the snapped dates, so `on_date_change` may not produce an edit intent and the interaction is treated as a click;
- a delayed Frappe click can arrive after a real drag/resize and open the task modal;
- after a drag, task details can therefore open unexpectedly.

A drag or resize attempt must never be interpreted as a task click, even when the final dates remain unchanged.

## Goal

Deliver a deterministic and product-quality distinction between:

- a deliberate task click that opens details;
- a drag attempt;
- a right-edge resize attempt.

At the same time, make labels for affected preview tasks collision-free and readable at every bar width.

## Locked scope

Do not change:

- backend scheduling or validation;
- ChangeSet structure or semantics;
- direct-edit API;
- AI/MCP behavior;
- Excel flows;
- weekend snapping;
- dependency-bound behavior;
- same-row preview architecture;
- solid requested outline / dashed dependency outline convention;
- Apply/Cancel lifecycle;
- stable direct-edit rendering from Rework 03.

This rework is frontend-only unless a test fixture or type declaration requires a contained adjustment.

---

# Part A — Collision-free labels

## A1. One visible task label

While a pending preview is open, each affected task must show exactly one visible task label.

Do not render:

- the normal external Frappe label plus another preview label;
- task text on the proposed orange outline;
- text between task rows;
- text on the same-row connector.

The upper `Изменения ещё не применены` panel remains the authoritative place for full names, exact dates, and reasons.

## A2. Preview-safe current label

For affected tasks only, suppress the normal Frappe label placement and render a dedicated label strictly inside the current blue bar.

Text priority:

1. Show the full compact label `N · Название задачи` when it fits with safe horizontal padding.
2. If the full label does not fit, show only the short public number, for example `6` or `7`.
3. If even the number cannot fit, hide visible text but keep the full accessible/hover text.

Requirements:

- measure the actual rendered text width; do not use name-length heuristics alone;
- keep at least 6–8 px horizontal padding inside the blue bar;
- use white text with the existing task-bar typography;
- full labels may be left-aligned with padding; number-only labels may be centered;
- clip the custom label to the current bar bounds so it cannot escape into preview geometry;
- do not shrink text below the existing readable product size merely to force it to fit.

Examples:

```text
wide current bar:
[ 6 · Сквозное тестирование ] --------> [ proposed outline ]

short current bar:
[ 7 ] --------> [ proposed outline ]
```

## A3. Layering

Preview geometry must not obscure the preview-safe current label.

Required visual order:

1. normal Gantt grid and dependency arrows;
2. current/proposed bar geometry as needed;
3. preview-safe current label above proposed fill and connector;
4. no other text in the overlay.

The proposed fill must stay light enough that a partial overlap does not visually erase the current blue bar. The orange outline remains the primary proposed-state signal.

The same-row connector must begin outside the current bar boundary and end outside the proposed bar boundary. It must never run through the current label.

## A4. Full text on hover and accessibility

For every affected task in preview:

- preserve the full task identity as `TASK-NNN · Название задачи` in a tooltip/title;
- preserve an accessible name for the current task bar;
- decorative orange preview geometry remains `aria-hidden` and `pointer-events: none`;
- do not expose a second pseudo-task to assistive technologies.

A native SVG `<title>` is acceptable if it is reliable in the current browser target. A contained custom tooltip is also acceptable, but do not add a large new tooltip system in this rework.

## A5. Unaffected tasks

Tasks not included in the pending preview keep their existing Frappe label behavior.

## A6. Apply and Cancel

When preview closes:

- remove all preview-safe custom labels;
- restore the normal Frappe label behavior;
- leave no hidden-label classes, clip paths, titles, or stale overlay nodes behind;
- preserve row count, scroll position, and stable canvas behavior.

---

# Part B — Pointer gesture intent

## B1. Do not infer drag intent only from changed dates

A drag attempt is a pointer gesture, not only a successful date change.

Track pointer interaction on task bars and the allowed right resize handle independently of `on_date_change`.

Use Pointer Events where supported so mouse, touch, and pen share one path.

## B2. Gesture session

For a pointer session on a task, track at minimum:

- `pointerId`;
- `taskPublicId`;
- origin coordinates;
- current coordinates / maximum movement;
- interaction target: task body or right resize handle;
- whether the drag threshold was crossed;
- whether the next click for that task must be consumed.

Recommended movement threshold: 3 CSS pixels. A similarly small documented value is acceptable, but it must catch the Human QA scenario where the user moves the mouse slightly and dates do not change.

## B3. Gesture classification

### Plain click

A task click opens the read-only modal only when:

- pointer down started on the task body;
- movement stayed below the drag threshold;
- no direct edit is pending;
- no pending ChangeSet is open;
- the interaction did not start on a resize handle.

### Drag attempt with unchanged dates

When movement crosses the threshold but snapped dates remain unchanged:

- do not call the backend;
- restore/retain authoritative geometry;
- do not open the modal;
- consume the click generated by that pointer gesture;
- the next separate deliberate click must work normally.

### Real drag

When movement crosses the threshold and dates change:

- emit exactly one direct move intent;
- do not open the modal before, during, or after the backend round-trip;
- consume any delayed Frappe/browser click belonging to the gesture;
- preserve the current stable-rendering behavior.

### Right-edge resize attempt

Pointer down on the allowed right resize handle is a resize gesture candidate, not a task click.

- clicking or moving the resize handle must never open task details;
- if the final duration is unchanged, do not call the backend and do not open the modal;
- if duration changes, emit exactly one resize intent;
- left resize remains disabled.

## B4. Suppression must be task-scoped, not timeout-only

Do not use the existing short `250 ms` timeout as the primary click/drag distinction.

Use a task-scoped suppression token, for example `suppressNextClickTaskId`, tied to the completed pointer gesture.

Rules:

- the first Frappe/browser click for the same task after a drag/resize attempt is consumed;
- consuming that click clears the suppression token;
- a new pointer-down sequence may clear stale suppression before starting the new gesture, so the next deliberate click is not lost;
- a longer fallback cleanup timer may exist only as protection against a stuck token;
- while the direct-edit request is pending, clicks on task bars must not open details.

The behavior must not depend on how quickly or slowly the backend responds.

## B5. Event containment

Handle click suppression before the modal callback is allowed to run.

A contained implementation may use:

- capture-phase pointer/click listeners on the Gantt host;
- refs consumed by Frappe `on_click`;
- pointer capture for the active task gesture.

Do not attach permanent document-level listeners without cleanup. Remove listeners and pointer state on unmount, pointer cancel, view reconstruction, Apply, Cancel, and Restore demo.

## B6. Preview and busy locks

Preserve existing locks:

- while pending preview is open, bars cannot be dragged/resized and clicks do not mutate the plan;
- while a direct-edit request is pending, a second direct edit cannot start;
- ordinary modal click behavior resumes once the gesture/request is finished.

---

# Regression coverage

Add focused frontend tests proving at minimum:

## Labels

1. A wide affected current bar shows the full `N · Название` label inside its blue bounds.
2. A short affected current bar falls back to the number only.
3. The preview-safe label geometry stays within the current bar bounds.
4. A proposed outline/connector never introduces overlay text.
5. A partial current/proposed overlap keeps the current label readable above the orange fill.
6. The full `TASK-NNN · Название` remains available as title/accessible text.
7. Unaffected tasks keep normal label behavior.
8. Apply and Cancel remove preview-specific labels and restore normal rendering.

## Gesture intent

9. A plain click without movement opens the modal exactly once.
10. A micro-drag crossing the threshold but producing unchanged dates does not call direct edit and does not open the modal.
11. After that micro-drag, a new separate click opens the modal normally.
12. A real drag emits exactly one move intent and a delayed `on_click` does not open the modal.
13. After the real drag/request completes, the next separate click works.
14. Pointer down/click on the right resize handle never opens the modal.
15. An unchanged resize attempt does not call the backend and does not open the modal.
16. A real resize emits exactly one resize intent and does not open the modal.
17. Pending preview and direct-edit busy states continue to block new gesture mutations.
18. Existing weekend snap, dependency-bound, stable-rendering, Apply/Cancel, persistence, and AI preview tests continue to pass.

Tests must cover the actual pointer gesture path; calling only `on_date_change` directly is not sufficient for the new click-vs-drag contract.

---

# Human QA

Record a short GIF covering:

1. Pending preview with one long-name affected task and one short affected bar; verify no text overlaps connector or orange outline.
2. Partial current/proposed overlap; verify the blue current label remains readable.
3. Micro-drag that leaves dates unchanged; verify no modal opens.
4. Immediately click the same task again; verify modal opens.
5. Real drag followed by delayed backend result; verify no modal opens automatically.
6. Right-edge press/resize attempt with no date change; verify no modal opens.
7. Real resize; verify one edit and no modal.
8. Apply and Cancel; verify normal labels return with no stale preview state.

# Acceptance criteria

Rework is accepted only when:

- no affected task text overlaps or is overlapped by proposed bars/connectors;
- affected task labels remain inside current blue bars during preview;
- short bars fall back cleanly to the task number;
- full task identity remains available by hover/accessibility;
- a drag/resize attempt never opens the task modal, even when dates do not change;
- delayed clicks after direct edits are consumed reliably;
- the next deliberate click still works;
- all accepted drag/resize, same-row preview, Apply/Cancel, and stable-rendering behavior remains intact;
- no backend or product-scope expansion is introduced.

# Verification

Run:

- targeted Gantt label and pointer-gesture tests;
- full frontend test suite;
- frontend lint;
- TypeScript / production build;
- full backend suite;
- dependency check;
- `git diff --check`.

Create one rework commit, leave the worktree clean, and stop for Human QA. Do not start Iteration 05, delivery, or deployment.
