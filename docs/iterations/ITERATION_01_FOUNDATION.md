# Iteration 01 — Foundation

**Status:** ACCEPTED  
**Baseline commit:** `9e08e9f1f13343f48e19c0bc3c30c364741ed74f`  
**Source of truth:** `docs/AI_Gantt_Planner_Master_Brief_v1.3.md`

## Goal

Create the deterministic project foundation without implementing Excel, ChangeSet, MCP, LLM, Gantt UI or Yandex Cloud deployment.

## Accepted scope

- Git repository initialized on `main`.
- React + TypeScript + Vite frontend skeleton.
- Stateless FastAPI backend skeleton.
- `GET /api/health` and `GET /api/seed`.
- Immutable `Task` and `PlanState` Pydantic models.
- Monday–Friday working calendar.
- Weekend normalization.
- Inclusive end-date calculation.
- Finish-to-Start scheduling.
- Multiple predecessors.
- Validation for unknown predecessor, self-reference and dependency cycles.
- Stable topological order and cycle path.
- Deterministic `TASK-NNN` generation for Replace and Append/create scenarios.
- Fixed seed with 7 tasks, parallel branches, dependency chain, multiple assignees and multiple predecessors.
- Unit and API smoke tests.

## Verification

Codex report:

- backend: `43 passed`;
- Python compile check: passed;
- frontend Oxlint: passed;
- TypeScript + Vite production build: passed;
- npm audit: 0 vulnerabilities;
- git working tree: clean.

Human QA:

- frontend dev server starts successfully;
- FastAPI starts successfully;
- seed preview loads through `/api/seed`;
- 7 seeded tasks are visible in frontend;
- absence of Gantt UI is expected for this iteration.

## Notes

- The repository was initially created by the Codex sandbox user; local Git trust was explicitly configured for this project directory.
- Generated local artifacts such as `tmp/` and `backend/ai_gantt_planner_backend.egg-info/` are not tracked.

## Out of scope in this iteration

- Excel import/export;
- ChangeSet;
- impact preview/confirmation flow;
- MCP;
- LLM;
- AI chat;
- Frappe Gantt;
- Yandex AI Studio;
- Yandex Cloud deployment.
