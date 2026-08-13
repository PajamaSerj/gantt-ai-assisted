# AI Gantt Planner

Iteration 1 repository foundation for the AI Gantt Planner MVP described in
`docs/AI_Gantt_Planner_Master_Brief_v1.3.md`.

This iteration intentionally contains only:

- a React + TypeScript + Vite application shell;
- a stateless Python/FastAPI application shell with `GET /api/seed`;
- `Task` and `PlanState` domain models;
- Monday-Friday working-day scheduling;
- Finish-to-Start dependency validation and scheduling;
- deterministic `TASK-NNN` generation;
- an immutable fixed seed snapshot;
- unit tests for this domain scope.

Excel, ChangeSet, MCP, LLM, AI UI, Gantt UI, persistence, and deployment are
explicitly deferred to later iterations.

## Requirements

- Node.js 20.19+ (Node.js 24 was used for this iteration)
- Python 3.12+

## Backend

```powershell
cd backend
python -m venv .venv
.venv\Scripts\python -m pip install -e ".[dev]"
.venv\Scripts\python -m uvicorn app.main:app --reload
```

The API is then available at `http://127.0.0.1:8000`; the fixed seed endpoint
is `GET /api/seed`.

Run the domain tests:

```powershell
cd backend
.venv\Scripts\python -m pytest
```

## Frontend

```powershell
cd frontend
npm install
npm run dev
```

Vite serves the application at `http://127.0.0.1:5173` and proxies `/api` to
the FastAPI development server.

Build and lint:

```powershell
cd frontend
npm run lint
npm run build
```
