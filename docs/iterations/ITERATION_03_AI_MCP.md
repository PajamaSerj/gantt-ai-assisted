# Iteration 03 — AI + MCP Backend

**Status:** READY
**Depends on:** Iteration 02 ACCEPTED after Rework 01 (`6580cf788ac1b8115603b0f45496bb6e884fbdeb`)
**Source of truth:** `docs/AI_Gantt_Planner_Master_Brief_v1.3.md`

## Goal

Implement the backend AI-native layer from the Master Brief: real MCP server/client tools, Qwen integration through Yandex AI Studio, and stateless `/api/chat` orchestration into the existing deterministic ChangeSet engine.

## Required scope

- Read `AGENTS.md`, Master Brief and this brief before changes.
- Verify current official MCP Python SDK and Yandex AI Studio API docs before implementation.
- Use real MCP execution: model tool selection -> MCP client -> MCP server tool -> shared deterministic business logic.
- The model must not receive the complete PlanState directly and bypass MCP; PlanState is request-scoped MCP context.
- Implement read tools: `get_tasks`, `get_task`, `get_dependencies`.
- Implement prepare tools: `create_task`, `update_task`, `move_tasks`, `set_assignee`, `add_predecessor`, `remove_predecessor`, `replace_predecessor`.
- Implement guarded `apply_changes`; confirmation-required changes cannot be authorized by the model.
- Preserve all Master Brief create/move/dependency/assignee/clarification rules and Iteration 02 final-state validation.
- Add a thin Qwen provider adapter; model/provider settings are environment-configured; no automatic fallback; no secrets committed.
- Implement stateless `POST /api/chat` with `applied`, `clarification_required`, and `confirmation_required` outcomes.
- LLM handles semantics and explanations; deterministic Python owns dates, IDs, graph/cycles, schedule validation, impacts and apply authorization.
- Automated tests must use a fake/mock provider and must not require live cloud credentials.

## Minimum verification

Test MCP tool execution and request isolation, public-ID/name resolution, non-mutating prepare tools, multi-tool final-state ChangeSet behavior, confirmation guard, safe edit apply, mass move, dependency/transitive impact confirmation, weekend confirmation, unseen-assignee confirmation, create placement/clarification rules, reserved-name validation, provider-error no-mutation, stale ChangeSet rejection, full backend regression suite and frontend lint/type/build.

## Out of scope

No Gantt/final frontend UI, AI drawer UI, frontend pending lifecycle, Excel attachment UI, task modal/localStorage integration, Docker/deployment, DB/auth or CI/CD. Excel content must remain on deterministic `/api/import`, not be sent to the model.

## Handoff

After implementation run checks, remove temporary artifacts, create one clear Iteration 03 commit, leave worktree clean, report results and stop before the UI iteration.
