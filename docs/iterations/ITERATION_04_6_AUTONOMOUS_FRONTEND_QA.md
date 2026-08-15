# Iteration 04.6 — Autonomous Frontend QA and Stabilization

Status: READY FOR IMPLEMENTATION  
Base commit: `e97ac944d3e915e67abd40ea139a3d4d5218b63f`  
Source of truth: `docs/AI_Gantt_Planner_Master_Brief_v1.3.md`

## Purpose

Run the first autonomous product-quality QA cycle for AI Gantt Planner.

This iteration is not a new product feature. Its purpose is to make the agent independently:

1. reproduce known interaction defects in a real browser;
2. build a repeatable browser QA harness;
3. test the main user flows and edge cases;
4. inspect the UI for obvious visual defects;
5. fix every implementation defect it finds within the approved product contract;
6. rerun the complete QA cycle until it is clean;
7. hand the product to the user only for a final human smoke test.

Do not stop after finding the first defect. Discovery, correction and retest are one continuous agent-owned loop.

## Known Human QA defects that must be reproduced first

### A. Task modal opens after a confirmed drag

Observed behavior:

1. A task is dragged.
2. The edit affects dependencies and opens a pending ChangeSet preview.
3. The user clicks `Применить всё`.
4. After application, task details sometimes open automatically without a new deliberate click.

Required behavior:

- drag/resize, preview transition and Apply must never open the task modal;
- delayed Frappe/browser click events from the original gesture must remain suppressed across the preview and Apply lifecycle;
- the next separate deliberate click must still open the modal exactly once.

### B. Drag/resize can become unavailable after repeated operations

Observed behavior:

- after moving tasks several times, task bars can stop responding to drag;
- the issue may be related to dragging close to the visible timeline edge or attempting to move beyond it, but the exact trigger is not yet confirmed.

Required behavior:

- no completed, cancelled, invalid or out-of-range gesture may leave the Gantt in a stuck disabled/busy state;
- task drag and right-edge resize must remain available after repeated operations;
- edge attempts, pointer cancellation, failed requests, preview Apply/Cancel and timeline reconstruction must all clean up gesture state, pointer capture, suppression tokens and transient CSS classes.

The agent must not assume these are the only defects. They are the minimum mandatory starting points.

---

# Agent operating mode

## 1. Autonomous correction loop

Use this loop until the completion gate is satisfied:

```text
inspect current implementation
→ reproduce defect in a real browser
→ add or improve a failing automated test
→ identify root cause
→ implement contained correction
→ run targeted tests
→ run full browser QA matrix
→ inspect screenshots/DOM/SVG/console
→ fix any newly discovered implementation defect
→ repeat until clean
```

Do not return a partial `ready for Human QA` report while known reproducible defects remain.

## 2. Product-decision boundary

The agent may autonomously fix:

- event lifecycle defects;
- stuck busy/disabled states;
- pointer/click/drag/resize classification defects;
- stale visual state;
- clipping, overlap and obvious layout regressions;
- responsive defects;
- console/runtime errors;
- missing test coverage;
- test-harness and deterministic QA infrastructure.

The agent must stop only when a correction requires a genuinely new product/business/security decision, such as changing scheduling semantics, confirmation policy, dependency rules, authentication, secret handling or deployment permissions.

Do not ask the user to choose between ordinary technical fixes that can be resolved inside the approved UX contract.

## 3. No video requirement

Do not record or commit QA video.

The agent should use:

- live browser inspection;
- DOM/SVG geometry assertions;
- screenshots only on failure or when useful for its own visual analysis;
- Playwright traces only on failure.

Final user acceptance will be performed by opening the product directly, not by reviewing a video.

---

# Browser QA harness

## 1. Add Playwright

Add a contained Playwright E2E setup to `frontend`.

Expected baseline:

- `@playwright/test` as a dev dependency;
- a stable `playwright.config.ts`;
- scripts such as `test:e2e` and an optional headed/debug script;
- Chromium as the required test browser;
- automatic startup of FastAPI and Vite through Playwright `webServer` configuration or an equally repeatable local runner.

Use the existing development topology:

- FastAPI on `127.0.0.1:8000`;
- Vite on a deterministic local port with `/api` proxying to FastAPI.

Configure Playwright by default with:

- `video: 'off'`;
- `screenshot: 'only-on-failure'`;
- `trace: 'retain-on-failure'`;
- deterministic locale/timezone where useful;
- no external network dependency for the main suite.

Do not commit browser binaries, reports, traces, screenshots or temporary QA output. Add generated QA paths to `.gitignore` where necessary.

## 2. Deterministic services

Use the real frontend and real deterministic FastAPI endpoints for:

- seed/reset;
- direct edits;
- ChangeSet prepare/apply;
- scheduling and dependency consequences;
- import/export where tested.

Do not require live Qwen credentials for the standard E2E suite.

For AI UI states, either:

- inject/use the existing fake provider path in a controlled test server; or
- intercept `/api/chat` with deterministic valid responses in Playwright.

The test must still exercise the real frontend state transitions. Live Qwen remains a separate smoke test and is not a blocker for autonomous frontend QA.

## 3. Test isolation

Every scenario must start from a known state by one of these contained mechanisms:

- clear planner localStorage and load seed;
- call Restore demo through the UI;
- create a fresh browser context.

No scenario may depend on execution order.

Capture and fail on:

- `pageerror`;
- unexpected console errors;
- failed application requests not explicitly expected by the scenario;
- unhandled promise rejection;
- React runtime warning indicating a real implementation problem.

---

# Required QA matrix

Run the core interaction suite at least at:

- `1440 × 900` — primary desktop;
- `1920 × 1080` — wide desktop;
- `1024 × 768` — compact desktop/tablet-width contract.

Not every expensive scenario must be repeated in all three viewports, but baseline rendering, preview geometry, AI drawer layout and horizontal navigation must be covered across the matrix.

## A. Baseline and visual structure

Verify:

- Russian demo seed loads with 7 tasks and 7 logical Gantt rows;
- no UUID is visible;
- task names and dependencies are readable;
- first task is not clipped;
- bounded timeline has sensible pre/post space;
- short timeline fills the available card width;
- long timeline remains horizontally scrollable;
- Day, Week and Month modes render without broken bars or labels;
- opening/closing the AI drawer does not break chart width, scroll position or preview geometry;
- no unexpected page-level horizontal overflow at 1024 px;
- no obvious empty blocks, clipped controls or overlapping toolbar elements.

## B. Click, micro-drag and resize gesture intent

Verify in the real browser:

1. Plain click without pointer movement opens the task modal exactly once.
2. Micro-drag crossing the approved movement threshold but not changing snapped dates:
   - does not call direct-edit API;
   - does not open the modal;
   - leaves the task draggable.
3. The next separate deliberate click after the micro-drag opens the modal normally.
4. Right resize-handle press/micro-movement without date change:
   - does not open the modal;
   - does not call the backend;
   - does not leave the handle/task disabled.
5. Real drag emits exactly one move request and never opens the modal.
6. Real resize emits exactly one resize request and never opens the modal.

## C. Safe direct edits

From restored demo:

- drag TASK-007 from Friday one working day forward; weekend snap must resolve to Monday;
- edit auto-applies without confirmation;
- no task modal opens before, during or after the request;
- no full-chart collapse or flicker-like zero-width geometry occurs;
- task remains draggable afterwards;
- F5 preserves the new PlanState without ghost overlays;
- Restore demo returns to the original seed.

Repeat an equivalent safe right-edge resize of TASK-007.

## D. Dependency-bound invalid drag

Attempt to drag a dependent task earlier than its minimum allowed FS start.

Verify:

- bar returns to authoritative position;
- concise dependency-bound message is shown;
- no pending preview is created;
- no modal opens;
- no busy/disabled class or pointer state remains;
- another valid drag works immediately afterwards.

## E. Impacted drag with Apply

Drag TASK-005 later so TASK-006 and TASK-007 are affected.

Verify:

- pending preview opens;
- there remains one logical row per task;
- current blue bars and proposed orange outlines share the same rows;
- direct proposed outline is solid;
- dependency-propagated outlines are dashed;
- preview-safe labels are inside current blue bars and do not collide with connectors/outlines;
- exact dates/reasons remain readable in the upper summary panel;
- drag/resize and new mutations are blocked while preview is open;
- clicking `Применить всё` applies the proposed plan;
- **no task modal opens as a delayed consequence of the original drag**;
- overlay is fully removed;
- task interactions are restored;
- the next deliberate click opens the correct task modal exactly once.

This scenario is a mandatory regression test for known defect A.

## F. Impacted drag with Cancel

Repeat the impacted drag and choose `Отменить`.

Verify:

- source PlanState is unchanged;
- overlay and preview labels are removed;
- scroll position remains sensible;
- no modal opens automatically;
- drag/resize immediately work again;
- next deliberate click works.

## G. Repeated-operation stress sequence

Run a deterministic sequence of at least 12 interactions in one browser session. Include a mix of:

- safe drag;
- safe resize;
- invalid dependency-bound drag;
- impacted drag + Cancel;
- impacted drag + Apply;
- Restore demo;
- view-mode switch;
- AI drawer open/close.

After every operation assert:

- no pending request is unintentionally left active;
- no stale `.gantt-direct-edit-busy`, transient disabled or equivalent blocking class remains;
- current bars have pointer interaction enabled when no legitimate lock is active;
- right resize handles remain usable;
- row count remains correct;
- no unexpected modal is open;
- a subsequent known-safe drag can still start.

This scenario is a mandatory regression test for known defect B.

## H. Timeline-edge stress

Explicitly test the suspected trigger:

1. scroll close to the left edge;
2. drag a task toward or slightly beyond the visible left timeline boundary;
3. release, including an invalid/no-op outcome;
4. scroll close to the right edge;
5. drag a task toward or beyond the visible right boundary;
6. switch view mode and return;
7. perform a normal safe drag.

Verify throughout:

- no lost pointer capture;
- no stuck gesture session;
- no stuck click-suppression token that blocks future legitimate clicks;
- no stuck direct-edit pending flag;
- no permanent `pointer-events: none` on task bars/handles;
- no broken horizontal scroll;
- no clipped or permanently displaced bar;
- normal drag/resize remains available after the edge attempts.

If moving beyond the configured timeline requires expanding/rebuilding the visible range, preserve the approved bounded timeline contract and stable rendering. Do not silently re-enable infinite padding.

## I. Pointer cancellation and recovery

Cover at least:

- `pointercancel` during a drag attempt;
- `lostpointercapture` if pointer capture is used;
- pointer release outside the Gantt host;
- request failure/aborted request during direct edit;
- Restore demo while no request is active;
- component/chart reconstruction after view-mode or container-width change.

Every path must clean up gesture/session state and leave the chart usable.

## J. Preview visual geometry

Use DOM/SVG bounding-box assertions, not only screenshots.

For affected tasks verify:

- preview-safe label bounds are inside current blue bar bounds;
- long labels use full compact text only when it fits;
- short bars fall back to the task number;
- orange proposed geometry and connectors do not cover the visible current label;
- no overlay text exists outside the approved preview-safe current label;
- connector begins outside current bar and ends outside proposed outline;
- current/proposed Y coordinates match;
- no extra task rows are created;
- proposed geometry stays inside valid SVG/timeline bounds;
- partial overlaps remain distinguishable;
- Apply/Cancel removes all preview-only nodes/classes/title/clip paths.

Use failure screenshots for visual inspection of any geometry assertion that fails.

## K. State and persistence

Verify:

- read-only/help chat response does not revert PlanState;
- safe direct edit persists after F5;
- pending preview lifecycle remains coherent;
- Restore demo clears plan edits, pending state and AI conversation;
- no stale modal, gesture or overlay state survives Restore;
- localStorage does not contain secrets or transient browser-test artifacts.

## L. Quick Excel regression

Run one lightweight deterministic round-trip:

- export current enriched plan;
- re-import a valid exported workbook through the supported flow;
- verify task data/dependencies remain valid;
- verify the Gantt remains interactive afterwards.

Do not expand Excel scope in this iteration.

---

# Root-cause expectations for the known defects

The agent must inspect and document the actual root causes rather than adding arbitrary timeouts.

## Modal after Apply

Inspect the full lifecycle across:

```text
pointer gesture
→ direct-edit request
→ confirmation response
→ pending preview
→ Apply
→ chart reconciliation
→ delayed Frappe/browser click
```

The task-scoped suppression contract must survive long enough to consume only the delayed click belonging to the original drag/resize. Apply/Cancel or chart reconstruction must not prematurely discard that protection. A new explicit pointer-down for a deliberate click must restore normal click behavior.

Do not solve this by making the modal globally unavailable for a long fixed delay.

## Drag becomes unavailable

Instrument and inspect all transient state involved in direct manipulation, including where applicable:

- active pointer session;
- pointer capture;
- drag threshold state;
- `suppressNextClickTaskId` or equivalent;
- direct-edit pending refs;
- React busy/disabled props;
- pending ChangeSet locks;
- Gantt host CSS classes;
- handle `pointer-events` styles;
- chart event listeners across reconstruction;
- request completion/failure cleanup.

The correction must be based on the identified stale state/listener/capture path. Do not hide the defect by forcing a page reload or Restore demo.

---

# Visual inspection responsibility

After automated assertions pass, the agent must inspect the application itself in a real browser at the required viewports.

Check for obvious product defects such as:

- clipped or overlapping task text;
- proposed outline obscuring current state;
- connectors crossing labels;
- malformed arrows;
- unstable canvas reconstruction;
- unexpected modal appearance;
- controls shifting or disappearing;
- empty white regions caused by sizing regressions;
- unreadable small text;
- broken scrolling;
- inconsistent Russian labels;
- obvious console/runtime errors.

If an obvious implementation defect is found, fix it immediately and rerun the full relevant QA matrix. Do not merely list it as a known issue unless it requires a new product decision.

Screenshots may be generated temporarily for the agent's own inspection but must not be committed unless explicitly required by a future instruction.

---

# Deliverables

## 1. Repeatable QA infrastructure

Expected repository changes include, where appropriate:

- Playwright configuration;
- E2E test helpers/fixtures;
- deterministic browser scenarios;
- package scripts and dependencies;
- `.gitignore` updates for generated QA artifacts.

Keep the harness understandable and proportionate to this project.

## 2. Product fixes

Fix all implementation defects reproduced or discovered during this autonomous pass, within the locked product contract.

## 3. QA report

Create:

`docs/qa/ITERATION_04_6_AUTONOMOUS_QA_REPORT.md`

The report must be concise and include:

- environments/viewports tested;
- scenario counts and results;
- known defects reproduced;
- root causes found;
- corrections made;
- additional defects found and fixed;
- console/page error result;
- any remaining limitation that genuinely requires a product/security decision;
- final readiness for human smoke test.

Do not embed videos, large screenshots, traces or generated reports in the repository.

---

# Completion gate

The iteration is complete only when all conditions below are satisfied:

1. Both known Human QA defects are reproduced by automated/browser scenarios before correction or otherwise conclusively diagnosed.
2. Both defects are fixed and covered by regression tests.
3. The required E2E suite passes.
4. The core interaction/stress suite passes **three consecutive times** to detect flaky stuck-state behavior.
5. Frontend unit/integration tests pass.
6. Frontend lint and TypeScript/production build pass.
7. Full backend suite and dependency check pass.
8. `git diff --check` passes.
9. No unexpected browser console/page errors remain.
10. Agent visual inspection finds no obvious unresolved implementation defect.
11. Generated screenshots/traces/reports are cleaned or ignored.
12. QA report is committed.
13. Worktree is clean.

Create one final iteration commit and stop.

Return a compact handoff containing:

- commit SHA/message;
- automated browser scenarios and consecutive-run result;
- tests/checks;
- defects reproduced and fixed;
- any remaining blocker requiring a user decision;
- `Ready for final human smoke test: YES/NO`.

Do not start Iteration 05, deployment or unrelated product development.