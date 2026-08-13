# AI Gantt Planner

Deterministic planning-engine foundation for the AI Gantt Planner MVP described in
`docs/AI_Gantt_Planner_Master_Brief_v1.3.md`.

Implemented through Iteration 4:

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
- real request-scoped MCP server/client execution for plan reads and prepared
  mutations;
- stateless `/api/chat` orchestration with fake-provider test coverage;
- an environment-configured Qwen adapter using the OpenAI-compatible Responses
  API in Yandex AI Studio;
- a reviewer-facing read-only Frappe Gantt workspace with task details,
  dependency visualization, scale controls, and pending-impact highlighting;
- a compact AI drawer integrated with the stateless chat and ChangeSet apply
  contracts;
- shared deterministic Excel import entry points, backend-generated export
  downloads, browser persistence, and demo reset;
- frontend unit/integration coverage for browser state and API contracts;
- unit and API tests for this scope.

Docker and deployment are explicitly deferred to later iterations.

## Requirements

- Node.js 20.19+ (Node.js 24 was used for this iteration)
- Python 3.12+

## Backend

```powershell
cd backend
python -m venv .venv
.venv\Scripts\python -m pip install -e ".[dev]"
.venv\Scripts\python -m uvicorn app.main:app --reload --env-file ..\.env
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
- `POST /api/chat` — message, current `PlanState`, and stateless conversation
  context; returns `applied`, `clarification_required`, or
  `confirmation_required` for normal planning outcomes.

Import always returns the unchanged source plan plus either all validation
errors or a transient ChangeSet classified as `AUTO_APPLICABLE` or
`CONFIRMATION_REQUIRED`. Applying reconstructs and revalidates the proposed
final state; the backend stores no plan or pending ChangeSet.

### AI provider configuration

Copy `.env.example` to a local `.env` (the command above passes it to Uvicorn)
or export the same values in the process environment. Local `.env` files are
ignored by git.

```text
YANDEX_CLOUD_API_KEY=<service-account API key>
YANDEX_CLOUD_FOLDER_ID=<AI Studio folder ID>
AI_MODEL=gpt://<folder ID>/qwen3.6-35b-a3b
AI_BASE_URL=https://ai.api.cloud.yandex.net/v1
```

`AI_MODEL` is required and never hardcoded by the backend. There is no automatic
provider/model fallback. Automated tests inject a fake provider and do not use
cloud credentials; they verify adapter, tool-contract, and orchestration wiring,
not live-model semantic compliance. Live Qwen behavior must be checked separately
with local environment configuration. The model receives conversation text and
MCP tool results, not the complete `PlanState`; Excel content remains on
deterministic `POST /api/import`.

Run the backend tests:

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

Run the frontend tests:

```powershell
cd frontend
npm run test
```

## Excel input contract

Only `.xlsx` is accepted, and only the active worksheet is read. Required
columns are `задача`, `описание`, `исполнитель`, `длительность`, and
`предшественники`; header case and surrounding whitespace are normalized.
Unknown columns and fully blank rows are ignored. Multiple predecessor names
use `;` as the canonical separator. Task names cannot contain `;`; escaping or
quoting that character is not supported in the MVP.
