# Iteration 04 — Rework 01: Product UX + State Integrity

**Status:** REWORK  
**Base implementation:** `62f064ab089926f4f5b0acdaf9b45e32f18b713e`  
**Source of truth:** `docs/AI_Gantt_Planner_Master_Brief_v1.3.md` + approved human-QA findings below

## Why this rework exists

Iteration 04 automated checks passed, but human QA exposed product-level defects that block acceptance. The app must be treated as a small real product, not as a disposable test/mockup shell. Preserve all accepted domain, Excel, ChangeSet, MCP and Qwen business rules; rework only the UI/integration/interaction layer plus narrowly required chat contract safeguards.

Human-QA findings:

1. Human task references are unclear. The product must never expose or rely on zero-based/array-index thinking.
2. Equivalent questions can produce noticeably inconsistent product responses.
3. A read-only question (`что ты умеешь`) was observed to restore a previously moved task to its old dates. Read-only/clarification flows must never roll back PlanState.
4. AI replies show raw Markdown markers and look unfinished.
5. Overall UI feels like a cheap test mockup rather than a polished planning product.
6. The AI drawer overlays and obscures the Gantt.
7. After message submit the interface appears frozen until the full response arrives.
8. Mouse/wheel scrolling inside the Gantt feels trapped/unpredictable.
9. Pajama Tech / PajamaTech branding is not part of this product and must not appear in the product UI or user-facing deliverables.

## Audit finding: PlanState integrity

Current frontend `responseState(response)` accepts `response.plan` for every chat outcome. This is too weak an invariant for a stateless browser-owned PlanState.

Approved invariant:

- `applied` is the only ordinary `/api/chat` outcome allowed to replace current PlanState.
- `clarification_required` must preserve the current browser PlanState exactly.
- `confirmation_required` must preserve the current browser PlanState exactly and only store the pending ChangeSet / conversation result.
- `provider_error` must preserve the current browser PlanState exactly.
- A late/stale/read-only response must never overwrite a newer local PlanState.
- Do not trust a no-mutation response body as authority to rewrite browser state merely because it contains a `plan` field.

Keep backend deterministic validation and existing stateless API ownership. Do not introduce a database or server-side plan storage.

Add a regression test where a clarification/confirmation/provider-error response deliberately contains an older PlanState and prove that the current frontend plan is not rolled back.

## 1. Human task references

Public task IDs remain `TASK-NNN`; do not renumber or change the approved ID model.

Product behavior:

- Never expose zero-based task positions to users.
- A natural-language reference such as `задача 7`, `task 7`, or bare numeric task identifier in task-reference context means public ID `TASK-007` if that exact public ID exists.
- It must never mean array index 7 or “the eighth element”.
- If the corresponding public ID does not exist, clarify instead of selecting a positional task.
- Make public IDs discoverable in the Gantt itself. A task should visibly include its compact public ID together with the task name, e.g. `TASK-007 · Demo readiness`, without exposing UUIDs.
- Modal continues to show the public ID and never the internal UUID.

Implement identifier normalization in a deterministic layer/tool resolver where practical; reinforce the rule in the model-visible semantic contract so the LLM does not invent positional semantics.

## 2. Stable product responses

LLM wording may naturally vary, but the product must feel stable:

- Same planning intent against the same state must produce the same semantic action/status.
- Routine success feedback should be concise and based on the deterministic result, not a free-form essay.
- Product meta/help questions such as `что ты умеешь?`, `что можешь?`, `помощь` must return a short canonical capability answer with unchanged PlanState. Prefer a deterministic pre-provider/help path so repeated equivalent help questions do not generate unrelated variants or unnecessary provider cost.
- Do not broaden this into a generic hard-coded NLP parser for planning commands. LLM remains responsible for normal planning semantics.

Canonical capability message should stay close to:

> Могу переносить задачи и группы задач, менять исполнителей и зависимости, добавлять новые задачи и помогать перестраивать план. Если данных не хватает или изменение затронет другие задачи — сначала уточню или попрошу подтверждение.

Exact punctuation may differ, but the capability content and length should remain stable.

## 3. Product-grade AI conversation UX

The chat must behave like a modern assistant instead of waiting silently for a request to finish.

On submit:

1. append the user's message to the visible conversation immediately;
2. clear the composer immediately;
3. show an animated assistant thinking/typing state immediately;
4. keep the conversation scroll anchored to the latest message unless the user intentionally scrolled upward;
5. replace the temporary state with the real assistant response when it arrives;
6. show provider/network errors as an assistant/error message without changing PlanState.

Do not use one global `busy` flag to make the entire product feel frozen. Split chat/import/export/apply activity state as necessary. While AI is thinking, read-only Gantt navigation and task modal access should remain responsive. Prevent duplicate chat submits for the same in-flight turn.

Actual token streaming is optional for this rework. Do not redesign the backend around streaming unless it is a small, clearly justified change. Immediate optimistic user-message rendering + animated thinking feedback is required.

## 4. AI message rendering

Users must never see raw Markdown syntax such as `**heading**` or leading `*` markers.

- Render the supported assistant formatting as real product typography: paragraphs, bold text, short lists, line breaks and compact sections.
- Use a safe Markdown/subset renderer or an equivalent structured renderer; do not enable unsafe raw HTML from model output.
- Keep user messages plain.
- Long AI responses must remain readable and compact, with sensible line length and spacing.
- Confirmation/impact UI should remain structured cards/actions rather than a raw text dump when structured backend data is available.

## 5. Standalone product identity — no Pajama Tech branding

This is a standalone employer test product, not a Pajama Tech branded product.

- Remove `PajamaTech planning`, `Pajama Tech`, PajamaTech branding marks/copy, or similar branding from the application.
- Product name: `AI Gantt Planner`.
- Do not add Pajama Tech branding to README, demo capture, generated workbook, page metadata or final user-facing delivery assets.
- Repository owner/account name is outside product UI/content scope and is not part of this rule.

## 6. Product visual redesign

Rework the shell toward a polished modern planning/SaaS tool. Do not make it look like a marketing landing page.

Required direction:

- Gantt remains the dominant working surface.
- Remove the oversized marketing-style hero and large serif headline; reclaim vertical space for the actual planner.
- Remove developer-facing copy such as `Все даты и зависимости рассчитаны детерминированным backend` from primary UI.
- Use a compact app header, clear page/workspace title, modern sans-serif typography, consistent spacing, border radii and controls.
- Prefer calm neutral surfaces, subtle depth and one restrained accent system over loud branding.
- Hover/focus/pressed/loading states should feel deliberate.
- Add short, smooth transitions where they communicate state change; avoid decorative motion that slows work.
- Keep controls visually compact and aligned; remove duplicate/competing AI launch controls if one clear control is sufficient.
- Preserve accessibility basics: focus visibility, labels, contrast and keyboard-operable controls.

Quality target: the interface should plausibly belong to a small paid B2B planning tool, not an internal prototype.

## 7. AI panel layout

On normal desktop/laptop widths, opening AI must not cover the Gantt with a modal scrim.

Required desktop behavior:

- AI opens as a compact right-side workspace panel, approximately 360–400 px unless actual layout testing justifies a nearby value.
- The main planner/Gantt area shrinks/reflows beside it instead of being obscured.
- No full-page blur/scrim on desktop.
- Closing AI returns the planner to full available width.
- Frappe Gantt must correctly redraw/reflow when its container width changes.
- Keep one clear AI entry point.

For narrow/mobile widths, an overlay/bottom-sheet fallback is acceptable if needed, but desktop employer-review flow is primary.

## 8. Gantt scrolling / navigation

Fix the current nested-scroll feeling.

Acceptance behavior on desktop:

- Normal mouse wheel over the chart must not trap or randomly redirect page scrolling.
- The chart should not show an unnecessary internal vertical scrollbar when task content fits.
- Horizontal timeline navigation remains available through a clear horizontal scrollbar and native trackpad horizontal gesture.
- Shift+wheel may map to horizontal navigation if useful, but plain vertical wheel should remain predictable.
- Scale changes must not jump to an unrelated date range.
- Opening/closing the AI side panel must not reset the timeline to an arbitrary position.
- Avoid wheel listeners that aggressively `preventDefault` unless strictly necessary.

Human QA should explicitly test mouse wheel, horizontal scrollbar and trackpad if available.

## 9. Copy / product tone

Replace prototype/debug wording with concise user-facing product copy.

- No references in primary UI to backend implementation details, reviewer mechanics, internal snapshots, deterministic engines, or “test mockup” language.
- Keep `AI Gantt Planner` as the product identity.
- Seed/example/reset functionality can remain because it is useful for the assignment, but phrase actions as normal product actions rather than developer diagnostics.
- AI answers should default to concise Russian when the user writes in Russian.

## Required regression coverage

At minimum add/update tests for:

- `applied` replaces/persists PlanState;
- `clarification_required` with an intentionally stale response plan cannot roll back the current plan;
- `confirmation_required` with an intentionally stale response plan cannot roll back the current plan;
- provider error cannot mutate/rollback PlanState;
- optimistic user message appears before the provider response resolves;
- composer clears immediately and thinking state is visible while request is pending;
- repeated canonical help query returns the stable capability response and does not mutate PlanState;
- human numeric task reference resolves through public `TASK-NNN`, never zero-based position;
- Gantt-visible task label includes public ID and name;
- raw Markdown syntax is not visibly rendered as literal markers for supported formatting;
- desktop AI panel does not require a full-page scrim and the planner remains present beside it;
- existing Iteration 04 tests for localStorage, pending ChangeSet, Excel entry points, export, modal, reset and read-only Gantt remain green.

Run full backend tests, frontend tests, lint, TypeScript/build, dependency check/audit as previously used, and `git diff --check`.

## Locked scope

Do not:

- change approved scheduling rules;
- rewrite ChangeSet/final-state validation;
- rewrite MCP architecture;
- replace Qwen/provider stack;
- add database/auth/users/roles;
- start Docker/deployment/delivery;
- add Gantt drag/resize scheduling;
- add AI Excel parsing;
- introduce a heavy design-system framework solely for this rework.

A small presentation dependency (for safe rich-text/Markdown rendering, if justified) is acceptable.

## Human QA gate after implementation

Stop after implementation and checks. Do not begin delivery.

Human QA must then verify in this order:

1. UI contains no Pajama Tech / PajamaTech branding and feels like a standalone AI Gantt Planner product.
2. Gantt visibly shows `TASK-NNN` IDs; `задача 7` moves `TASK-007`, never an array position.
3. Move `TASK-007` by one week and confirm the new dates visually.
4. Ask `что ты умеешь?` twice; capability answer is stable/concise and the moved task stays moved both times.
5. Send a real AI command and observe immediate user bubble, cleared composer, animated thinking state and responsive Gantt while waiting.
6. Verify formatted assistant response contains no literal Markdown markers.
7. Open AI on desktop and confirm it sits beside, not on top of, the Gantt.
8. Test mouse wheel + horizontal timeline navigation; no unnecessary internal vertical scrollbar or trapped page scroll.
9. F5 preserves the moved PlanState and conversation correctly.

Only after these pass should QA continue with pending confirmation, both Excel import entry points, export and reset from the original Iteration 04 checklist.

## Handoff

After implementation:

- create one clear rework commit;
- leave the worktree clean;
- report exact files changed and verification results;
- call out any necessary deviation from this brief before proceeding;
- stop for human QA; no deployment/delivery work.
