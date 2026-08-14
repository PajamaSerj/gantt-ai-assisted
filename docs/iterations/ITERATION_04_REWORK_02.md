# Iteration 04 — Rework 02: Product Polish + Conversation Targeting

**Status:** REWORK  
**Base implementation:** `732771d2b9b81aab18d50be17e5ae66701a8bcbd`  
**Source of truth:** `docs/AI_Gantt_Planner_Master_Brief_v1.3.md` + approved Human QA findings below

## Goal

Finish the current UI/productization pass without starting delivery/deployment. Preserve accepted domain, Excel, ChangeSet, MCP, Qwen and stateless PlanState architecture. This rework is a focused polish pass based on the second Human QA cycle.

## Human QA findings

1. Full `TASK-007` labels on every Gantt row reduce scanability.
2. Chat visually says `Анализирую план` for every request, including casual/meta text; only the loading animation is wanted.
3. Restore-success feedback remains visible too long.
4. Gantt contains a large unused white area below the tasks.
5. `Восстановить пример` should be `Восстановить демо`.
6. Mouse-wheel behavior over the Gantt still feels abnormal.
7. Screenshots show additional visual/product inconsistencies that should be polished now.
8. After several explicit commands targeting task 7, a later generic request `сдвинь задачу на день вперед` reused TASK-007 without asking which task.
9. The task-details modal can visually confuse the current task with predecessor numbering even though the data itself is correct.

## 1. Compact task numbering on the Gantt

Do not change the public ID model. `TASK-NNN` remains the canonical task identifier everywhere in domain/API/MCP/Excel contracts.

For Gantt display only:

- derive a compact visible number from the public ID;
- display `7 · Demo readiness`, not `TASK-007 · Demo readiness`;
- preserve gaps: `TASK-007` and `TASK-009` must display `7` and `9`, never positional `7` and `8`;
- never derive the visible number from array index/order;
- modal and structured details continue to show the full canonical `TASK-007` ID.

This is presentation-only shortening, not ID renumbering.

## 2. Loading indicator without misleading text

When chat is waiting for a response:

- keep the existing animated dots / typing animation;
- remove visible text such as `Анализирую план`;
- the animation should work equally for planning commands, help/meta text, clarifications and casual text;
- preserve an accessible non-visual status label such as `AI отвечает` if useful for screen readers;
- avoid visible flicker for extremely fast deterministic responses where practical (a small ~150–200 ms appearance delay is acceptable but not mandatory if it complicates tests).

The optimistic user bubble and immediate composer clear from Rework 01 remain locked.

## 3. Transient notifications / toast lifecycle

Success/status notices must not remain indefinitely or continuously consume layout height.

- Restore-success notification auto-dismisses after approximately 5 seconds.
- Apply/import/export success notices should follow the same transient behavior unless a specific action requires persistence.
- Errors may remain until the next action or explicit dismissal; do not hide actionable errors after 5 seconds by default.
- Prefer a lightweight floating toast/toast-stack position so showing and hiding a notice does not vertically shift the Gantt workspace.
- Keep messages concise.

Restore success copy:

`Демо-план восстановлен.`

## 4. Remove unnecessary blank Gantt height

The current viewport-derived minimum height creates a large blank white region below the seven task rows.

Required behavior:

- Gantt/card height should follow actual chart content on ordinary desktop screens;
- remove `calc(100vh - ...)` style minimums that force empty workspace height when the chart has only a few tasks;
- keep a modest minimum height only if necessary for a clean empty/loading state, not for populated charts;
- the Gantt remains visually dominant, but dominance should come from width and hierarchy rather than empty white height;
- cards with larger imported plans may naturally grow/scroll according to Frappe behavior and page constraints.

Do not solve this by hardcoding a height for seven seed tasks only.

## 5. Restore terminology

Use `Восстановить демо` consistently in product UI.

Update related copy to the same product vocabulary:

- toolbar action: `Восстановить демо`;
- confirmation should refer to restoring the demo plan, not an “example” or developer snapshot;
- loading/errors/success copy should use `демо-план` where needed.

Do not use Pajama Tech branding anywhere.

## 6. Gantt wheel / scroll behavior

Audit finding: Frappe Gantt has `infinite_padding: true` by default. With infinite padding enabled, the library binds `mousewheel` on the chart container and can extend/redraw the timeline while compensating `scrollLeft`. This conflicts with the desired predictable page-wheel behavior and matches the Human QA symptom.

Required correction:

- explicitly set `infinite_padding: false` for this product;
- keep plain vertical mouse wheel behavior native/predictable for page scrolling;
- keep horizontal timeline navigation via the chart horizontal scrollbar and native horizontal trackpad gesture;
- Shift+wheel horizontal navigation is optional only if it behaves naturally and does not trap normal wheel events;
- do not add aggressive `preventDefault` wheel interception;
- no unnecessary internal vertical scrollbar when chart rows fit;
- preserve horizontal scroll position across harmless React re-renders and AI panel open/close;
- scale changes should stay near the current plan range and must not jump to an unrelated date.

Add a focused regression/DOM-level test for the product configuration proving `infinite_padding` is disabled. Human QA remains the authority for actual mouse feel.

## 7. Additional screenshot polish

### Gantt locale

The current Russian application still shows timeline copy such as `January`, `February`, `March` and English abbreviated week labels.

- configure Frappe Gantt to use Russian locale for timeline month/date labels if supported by the installed version;
- if library locale support requires a locale code/value, use the officially supported mechanism rather than manually rewriting rendered SVG text;
- keep task names/descriptions in their stored language; only Gantt date/calendar chrome is localized.

### Workspace heading

- remove the low-value eyebrow `Рабочая область` above `План проекта`;
- keep the page hierarchy compact: app header → `План проекта` → Gantt;
- preserve the useful task/assignee stats if they remain visually balanced.

### Success feedback

- prefer toast presentation over an inline full-width feedback row so the planning surface does not jump after routine operations.

Do not start another broad visual redesign. Rework 01 visual direction is accepted; this is targeted refinement.

## 8. Conversation targeting: no hidden default task

This is a semantic safety/product rule.

Observed bad flow:

1. user explicitly moves task 7;
2. user explicitly moves task 7 again;
3. user says `сдвинь задачу на день вперед`;
4. assistant silently continues moving TASK-007.

Approved rule:

- A completed prior operation does **not** establish a hidden default task target for future generic mutation commands.
- A new mutation request using a generic singular noun such as `задачу` / `task` without an ID, name or other unambiguous selector must ask which task.
- Prior conversation history may be used only for explicit continuation/anaphora, e.g. `сдвинь её ещё на день`, `эту же задачу`, `move it one more day`, when the referent is unambiguous.
- A direct answer to an assistant clarification may also resolve the missing target.
- Generic `сдвинь задачу на день` is **not** an anaphoric continuation and must not inherit the last task.
- Do not use previous successfully applied targets as implicit defaults.

Implementation guidance:

- reinforce this rule explicitly in the live model-visible semantic contract;
- add deterministic/narrow orchestration or validation safeguards where practical for generic-target mutation requests;
- do **not** build a broad regex NLP planner that replaces Qwen semantics;
- tool calls for mutation still require explicit resolved task identifiers;
- if the model tries to infer a prior task for a clearly generic current request, the product must prefer clarification over applying a mutation.

Required live/model regression scenario:

- turn 1: `сдвинь задачу 7 на день вперед` → TASK-007 moves;
- turn 2: `сдвинь задачу 7 на день вперед` → TASK-007 moves again;
- turn 3: `сдвинь задачу на день вперед` → `clarification_required`, plan unchanged;
- a separate explicit continuation such as `сдвинь её ещё на день` may reuse the prior explicit TASK-007 target when unambiguous.

Fake-provider tests can verify the contract/orchestrator behavior but must not be described as proof of live-model compliance. Human/live Qwen QA will repeat this scenario after implementation.

## 9. Modal relation clarity

Human QA visually interpreted predecessor `TASK-006` as if the opened `TASK-007` had become task 6. The data is correct; presentation needs clearer semantics.

Keep the full current task ID chip at the top.

Change relation presentation:

- replace `Предшественники` with user-facing `Зависит от`;
- replace `Последователи` with `Влияет на` or similarly clear product wording;
- relation items may use compact display IDs such as `6 · End-to-end QA` to reduce visual competition with the current task chip;
- underlying relations still use canonical public IDs and internal UUIDs exactly as before;
- no editing controls in modal.

## 10. Deterministic applied-response usefulness

Current deterministic success text is stable but too generic (`Изменения применены: TASK-007 · Demo readiness.`).

Improve routine mutation feedback without returning control to free-form provider text.

For move operations, when deterministic ChangeSet/application data makes it reliably available, prefer concise feedback containing:

- affected task compact/public reference;
- the applied movement or resulting date range;
- working-day wording where relevant.

Example style:

`Задача 7 перенесена на 1 рабочий день. Новые даты: 4–5 марта.`

Do not invent data that is not deterministically available. For other mutation types, keep concise deterministic summaries appropriate to the change. Provider prose must not override the authoritative applied result.

## Required regression coverage

At minimum add/update tests for:

- Gantt label uses public-ID-derived compact number and name, not full `TASK-NNN` and not array index;
- full `TASK-NNN` remains visible in modal;
- loading UI has animated indicator without visible `Анализирую план` copy;
- transient success notice auto-dismiss behavior (fake timers acceptable);
- populated Gantt does not receive viewport-derived forced minimum height from app CSS/layout contract;
- restore button/copy uses `Восстановить демо` / `демо-план`;
- Frappe product configuration explicitly sets `infinite_padding: false`;
- Gantt calendar locale is configured to Russian through supported library configuration;
- generic task mutation after prior TASK-007 turns requires clarification and leaves PlanState unchanged;
- explicit anaphoric continuation can reuse the prior target only when unambiguous;
- modal relation labels use clearer wording (`Зависит от`, `Влияет на` or approved equivalent);
- move applied message remains deterministic and, when supported by deterministic data, includes useful resulting movement/date information;
- all Rework 01 PlanState integrity tests remain green;
- all original Iteration 04 localStorage, pending ChangeSet, Excel entry-point, export, reset, modal and read-only Gantt tests remain green.

Run:

- full backend tests;
- frontend tests;
- frontend lint;
- TypeScript / production build;
- dependency check / npm audit as previously used;
- `git diff --check`.

## Locked scope

Do not:

- change canonical task IDs or renumber tasks;
- change approved scheduling/business rules;
- rewrite ChangeSet/final-state validation;
- rewrite MCP transport/architecture;
- replace Qwen/provider stack;
- add DB/auth/users/roles;
- start Docker/deployment/delivery;
- add Gantt drag/resize scheduling;
- add AI Excel parsing;
- perform another unrelated full visual redesign.

## Human QA gate after implementation

Stop after implementation and checks. Do not begin delivery.

Human QA should verify in this order:

1. Gantt labels read like `1 · Product discovery` ... `7 · Demo readiness`; modal still shows `TASK-007`.
2. Chat waiting state shows only the animated response indicator, no `Анализирую план` text.
3. `Восстановить демо` works and its success toast disappears after ~5 seconds.
4. Gantt no longer has a large empty white field below the seed tasks.
5. Timeline month/week labels are localized to Russian.
6. Plain mouse wheel over the Gantt feels like normal page scrolling; horizontal scrollbar/trackpad navigation remains usable.
7. Move task 7 twice, then send `сдвинь задачу на день вперед`; assistant asks which task and does not mutate the plan.
8. Then send an explicit continuation (`сдвинь её ещё на день`) in a clean/unambiguous sequence and verify target continuity works intentionally.
9. Open TASK-007 modal and confirm relation wording cannot be mistaken for the current task number.
10. Confirm routine move success feedback is concise, stable and more informative.
11. F5 still preserves plan + conversation after the above flows.

Only after these pass should QA continue with pending confirmation, Excel import/export and reset checks for final Iteration 04 acceptance.

## Handoff

After implementation:

- create one clear rework commit;
- leave the worktree clean;
- report exact files changed and verification results;
- call out any required deviation before proceeding;
- stop for Human QA;
- do not start delivery/deployment.
