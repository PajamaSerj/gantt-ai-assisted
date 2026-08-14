# Iteration 04.5 — Rework 05: Minimal Same-row Preview

Status: REWORK  
Base commit: `e3688b85a2d38c06f197faf5a9d6757d69311c68`  
Source of truth: `docs/AI_Gantt_Planner_Master_Brief_v1.3.md`

## Human QA finding

Rework 04 correctly removed duplicate vertical task rows and introduced a custom same-row SVG overlay. However, the current implementation is visually overloaded in the real Gantt:

- current task text is duplicated;
- proposed bars contain extra text;
- delta/reason chips are rendered between task rows;
- labels overlap dependency arrows and neighboring tasks;
- very small text reduces readability;
- information already present in the upper `Изменения ещё не применены` summary is repeated inside the chart.

The overlay architecture is useful and must be kept. The visual language must be simplified.

## Goal

Turn the pending preview into a minimal spatial comparison:

- current blue bar remains the only place where the task number/name is shown;
- proposed position is shown as a clean orange outline/light fill on the same row;
- a horizontal dashed connector is shown only when there is enough free space;
- exact dates, delta and reason remain in the upper summary panel;
- no text, chips or labels are rendered between Gantt rows.

The Gantt should answer only: **where is the task now and where will it be after Apply?**

## Locked scope

Do not change:

- backend scheduling or ChangeSet semantics;
- direct-edit API;
- AI/MCP behavior;
- Excel import/export;
- approved drag/resize rules;
- weekend snapping;
- dependency-bound behavior;
- Apply/Cancel lifecycle;
- stable rendering from Rework 03;
- one logical task per Gantt row from Rework 04.

Keep the existing custom SVG overlay approach. Do not reintroduce duplicated Frappe pseudo-task rows.

## Required visual simplification

### 1. Current task

For every affected task:

- keep the normal blue task bar unchanged;
- keep the task number/name exactly once, using the existing Frappe task label;
- remove any extra `Текущее` label or duplicated current task text from the overlay.

### 2. Proposed task state

Render the proposed state on the same row as:

- orange outline;
- very light translucent orange fill;
- same task-bar height and corner radius;
- no text inside the proposed bar;
- no `После применения` text inside or next to the bar;
- `pointer-events: none`.

The upper summary panel remains the source of exact dates and explanation.

### 3. Direct versus dependency change

Distinguish source only by visual style:

- directly requested change: solid orange outline;
- dependency-propagated change: dashed orange outline.

Do not render `Запрошенное изменение` or `Сдвиг из-за зависимости` as per-row text inside the Gantt.

Update the legend to explain the three states clearly:

- blue filled marker — `Текущие даты`;
- orange solid outline — `Запрошенное изменение`;
- orange dashed outline — `Сдвиг по зависимости`.

### 4. Horizontal connector

For non-overlapping moves:

- draw a thin dashed orange connector from current to proposed position;
- show an arrowhead in the actual move direction;
- support both leftward and rightward moves;
- keep the connector centered on the same task row;
- do not reuse dependency-arrow styling.

Render the connector only when the visible gap is large enough to remain clear. If bars touch or overlap, omit the connector.

### 5. Overlap handling

When current and proposed ranges partially or fully overlap:

- preserve the normal blue current bar;
- render the orange proposed outline over the proposed range;
- use sufficient stroke contrast so both states remain distinguishable;
- do not add text to explain the overlap;
- do not create vertical offsets or additional rows.

### 6. Resize preview

For a duration change:

- current blue bar remains unchanged;
- orange proposed outline shares the same start date when start is unchanged;
- proposed outline extends or contracts to the proposed end date;
- emphasize the new proposed right edge with a subtle orange vertical line if useful;
- remove per-row text such as `3 → 5 раб. дней` from the Gantt;
- exact duration change remains in the upper summary panel.

If resize causes downstream moves, those downstream tasks receive the same minimal move overlay using dashed orange outlines.

### 7. Remove current per-row overlay labels

Remove from the Gantt overlay:

- `.gantt-preview-current-label` output;
- proposed text inside bars;
- `.gantt-preview-label` cards/chips;
- delta text;
- reason text;
- all geometry reserved for labels below bars;
- all label placement logic designed to fit those elements at timeline edges.

No overlay element may occupy the vertical space between task rows.

### 8. Upper summary panel

Keep and rely on the existing `Изменения ещё не применены` panel for:

- task number/name;
- old dates → proposed dates;
- direct/dependency reason;
- exact working-day or duration change;
- Apply/Cancel controls.

Do not remove or reduce this information merely because the Gantt overlay is simplified.

## Layout and interaction requirements

- chart row count remains equal to the current plan task count;
- chart height does not grow when preview opens;
- task order and Y positions remain stable;
- overlay remains aligned after horizontal scroll, view-mode changes, container resize and AI drawer open/close;
- pending preview continues to block drag and resize;
- overlay elements never capture pointer events;
- Apply removes all overlay elements and makes proposed dates authoritative;
- Cancel removes all overlay elements without changing current dates;
- no full-chart collapse, flicker, clipped bars or stale overlay elements.

## Technical direction

Refactor the existing `gantt-preview-overlay` implementation rather than replacing it.

Expected simplification:

1. Keep current Frappe tasks only.
2. Keep proposed bar geometry and same-row connectors.
3. Remove label geometry and label SVG generation.
4. Encode direct/dependency source through CSS classes or data attributes on the proposed bar.
5. Keep overlap, left/right direction and resize geometry.
6. Keep overlay redraw/removal lifecycle connected to preview, view mode and resizing.

Do not introduce a new chart library, state-management framework or backend endpoint.

## Regression coverage

Add or update focused tests proving at minimum:

1. Seven demo tasks still produce exactly seven Gantt rows during preview.
2. No pseudo-task rows or duplicated Frappe tasks are introduced.
3. No `.gantt-preview-current-label`, `.gantt-preview-label`, delta or reason text nodes are rendered.
4. Current and proposed geometries share the same Y coordinate.
5. Direct proposed bar uses solid outline styling/source class.
6. Dependency proposed bar uses dashed outline styling/source class.
7. Rightward and leftward connectors appear only when sufficient gap exists.
8. Overlapping ranges omit the connector but retain a visible proposed outline.
9. Resize preview keeps the same start and shows the proposed end/outline.
10. Apply and Cancel remove overlays correctly.
11. Pending preview still blocks drag/resize.
12. Existing stable-rendering, weekend, dependency-bound, AI preview and persistence tests continue to pass.

## Human QA

Record or inspect these scenarios:

1. Move TASK-005 so TASK-006 and TASK-007 shift: verify clean same-row overlays with no extra text between rows.
2. Repeat and Cancel.
3. Move a task left: verify left-pointing connector.
4. Create a short/overlapping move: verify no connector and readable orange outline.
5. Resize TASK-005: verify same-row duration outline and downstream dashed overlays.
6. Open/close AI drawer and switch Day/Week/Month while preview is open.
7. Create the same type of preview through AI and confirm identical visualization.

## Acceptance criteria

Rework is accepted when:

- the chart contains no duplicated task names or per-row explanatory chips;
- no preview text overlaps arrows, bars or adjacent rows;
- current and proposed positions remain immediately comparable on one row;
- direct and dependency changes are distinguishable through outline style and legend;
- the upper summary provides all detailed explanation;
- Apply/Cancel, drag/resize and AI preview remain correct;
- the preview feels visually calm, readable and product-ready.

## Verification

Run:

- targeted preview-overlay tests;
- full frontend test suite;
- frontend lint;
- TypeScript / production build;
- full backend suite;
- dependency check;
- `git diff --check`.

Create one rework commit and stop for Human QA. Do not begin Iteration 05, delivery or deployment.
