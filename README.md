# AI Gantt Planner

Deterministic planning-engine foundation for the AI Gantt Planner MVP described in
`docs/AI_Gantt_Planner_Master_Brief_v1.3.md`.

Implemented through Iteration 2:

- a React + TypeScript + Vite application shell;
- a stateless Python/FastAPI application with seed, import, apply, and export APIs;
- `Task` and `PlanState` domain models;
- Monday-Friday working-day scheduling;
- Finish-to-Start dependency validation and scheduling;
- deterministic `TASK-NNN` generation;
- an immutable fixed seed snapshot;
- deterministic `.xlsx` active-worksheet import and Excel-compatible export;
- Replace/Append planning with atomic validation;
- transient ChangeSets with final-state batch validation, transitive impact
  analysis, confirmation guard, and apply-time revalidation;
- unit and API tests for this scope.

MCP, LLM, `/api/chat`, AI UI, Gantt UI, persistence, Docker, and deployment are
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

The API is then available at `http://127.0.0.1:8000`.

Available endpoints:

- `GET /api/health`
- `GET /api/seed`
- `POST /api/import` — multipart form with `.xlsx` `file`, `mode` (`replace`
  or `append`), ISO `date_constraint`, and JSON-serialized `current_plan`;
- `POST /api/changesets/apply` — current plan, prepared ChangeSet, and explicit
  `apply_all` or `cancel` choice;
- `POST /api/export` — current `PlanState`, returned as `.xlsx`.

Import always returns the unchanged source plan plus either all validation
errors or a transient ChangeSet classified as `AUTO_APPLICABLE` or
`CONFIRMATION_REQUIRED`. Applying reconstructs and revalidates the proposed
final state; the backend stores no plan or pending ChangeSet.

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

## Excel input contract

Only `.xlsx` is accepted, and only the active worksheet is read. Required
columns are `задача`, `описание`, `исполнитель`, `длительность`, and
`предшественники`; header case and surrounding whitespace are normalized.
Unknown columns and fully blank rows are ignored. Multiple predecessor names
use `;` as the canonical separator. Task names cannot contain `;`; escaping or
quoting that character is not supported in the MVP.
