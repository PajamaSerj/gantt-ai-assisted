# Iteration 03 — Rework 01: AI semantic contract

Status: REWORK
Base commit: `557cf9461f5f76fed87e8cfdb83fe516bc95213a`
Source of truth: `docs/AI_Gantt_Planner_Master_Brief_v1.3.md`

## Finding

The MCP, ChangeSet and provider architecture is acceptable, but the live model instructions do not explicitly include several approved natural-language rules from the Master Brief. The model does not receive the Master Brief itself, so generic guidance to clarify ambiguous wording is not sufficient for these project-specific cases.

## Required correction

Keep the current architecture and tool set. Do not start UI work.

- Explicitly encode in the live Qwen instructions that scheduling shifts expressed as N days mean N working days.
- Explicitly encode that a one-week scheduling shift means 5 working days.
- A request referring only to next week without a concrete date or weekday must ask for clarification instead of choosing a date.
- Plain wording that places one task after another is ambiguous between a date move and a dependency unless the user explicitly states which intent is wanted; ask for clarification.
- An explicit date move never creates a dependency. An explicit dependency request must use dependency tools.
- Never invent missing management data.
- Update the `move_tasks` tool guidance so `after_task_identifier` is used only for an explicitly unambiguous relative date-move intent.
- Preserve deterministic ownership of date arithmetic, working-day traversal, validation, impacts, TASK-ID generation and apply authorization.
- Add regression coverage showing that these semantic rules are included in the provider contract and that `apply_changes` remains hidden from model-visible tools. Fake-provider tests must not be described as proof of live-model compliance.
- Do not add credentials or hardcode provider secrets. Live Qwen behavior will be checked separately with local environment configuration.

## Locked scope

Do not rewrite MCP transport, ChangeSet logic, Excel logic or frontend. Do not add another LLM framework. Do not start the UI iteration.

## Verification

Run targeted tests, full backend suite, dependency check, frontend lint/build and diff check. Create one rework commit, leave the worktree clean, report results and stop.
