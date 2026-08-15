# Iteration 05.1 — Containerization and local production runtime

Status: READY FOR IMPLEMENTATION  
Base commit: `ca7968ebfdeafcc738c1b1bb427c4b875cb0ad81`  
Source of truth: `docs/AI_Gantt_Planner_Master_Brief_v1.3.md`

## Purpose

Package the accepted AI Gantt Planner application as one reproducible production Docker image before any Yandex Cloud resources are created.

The image must contain:

- the production React build;
- the FastAPI backend;
- all required runtime Python dependencies;
- one production startup command;
- no secrets, local environment files, test reports, caches or development dependencies that are not required at runtime.

This iteration ends with a locally verified container. It does **not** create or modify Yandex Cloud resources.

## Accepted deployment architecture

The final cloud architecture is locked as:

```text
public HTTPS URL
        ↓
Yandex Serverless Container
        ├─ FastAPI /api/*
        └─ React SPA / and static assets

Docker image storage:
Yandex Container Registry

AI provider:
Yandex AI Studio / Qwen

Secret delivery:
Yandex Lockbox → YANDEX_CLOUD_API_KEY environment variable
```

This iteration implements only the single-image application runtime shown above.

## Product freeze

Do not add or redesign product functionality.

Locked behavior includes:

- Gantt rendering and direct manipulation;
- same-row ChangeSet preview;
- Apply/Cancel lifecycle;
- AI/MCP behavior;
- Excel import/export;
- browser persistence;
- Russian UI and validation messages;
- autonomous QA contracts already accepted through Iteration 04.6.

Only contained corrections required to make the same accepted application work in a production container are allowed.

---

# Part A — Multi-stage Docker image

## A1. Root Dockerfile

Create a root-level `Dockerfile` using a multi-stage build.

Expected logical stages:

### Frontend build stage

- use a supported Node.js image compatible with the current frontend requirements;
- copy `frontend/package.json` and `frontend/package-lock.json` first;
- install dependencies with `npm ci`;
- copy the frontend source;
- run the existing production build;
- produce `frontend/dist`.

### Python runtime stage

- use Python 3.12 slim or an equivalent minimal production-compatible base;
- install the backend as a normal non-editable package from `backend/pyproject.toml`;
- copy only backend runtime source and built frontend assets required for execution;
- do not include local virtual environments, Node modules, source maps unless intentionally required, QA traces, screenshots, Git metadata or `.env` files;
- run the application as a non-root user;
- set a deterministic working directory;
- expose/document the default local port `8080`;
- start Uvicorn on `0.0.0.0` using the runtime `PORT` environment variable, with local fallback `8080`.

Conceptual command contract:

```text
uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}
```

Use a process form that correctly expands `PORT` and forwards termination signals to Uvicorn.

## A2. Reproducibility and caching

Structure Docker layers so ordinary source changes do not unnecessarily reinstall all dependencies.

Required:

- frontend lockfile is authoritative (`npm ci`, not floating `npm install`);
- Python dependencies come from the committed backend project metadata;
- the build works from repository root with no reliance on locally installed `node_modules`, `.venv`, generated frontend `dist` or user-specific paths;
- repeated builds from the same commit and dependency metadata should be equivalent for the purposes of this test assignment.

Do not introduce a second package manager or an unnecessary Docker Compose topology.

---

# Part B — Docker build context safety

## B1. `.dockerignore`

Create a root `.dockerignore` that excludes at minimum:

- `.git` and Git metadata;
- all `.env` files and local secrets;
- Python virtual environments;
- Python caches and test caches;
- Node modules;
- frontend build output from the host;
- Playwright browser binaries, reports, traces and screenshots;
- temporary `tmp/` content;
- editor/IDE metadata;
- generated coverage artifacts;
- local Docker/runtime logs.

Do not accidentally exclude files required by the production build, especially:

- frontend lockfile and source;
- backend `pyproject.toml` and package source;
- runtime configuration code.

## B2. Secret invariant

The Docker image and build history must not contain:

- `YANDEX_CLOUD_API_KEY`;
- the user's local `.env`;
- browser diagnostic snapshots;
- access tokens;
- credentials created for future Yandex Cloud automation.

No secret may be accepted as a Docker `ARG` or baked into an `ENV` layer.

Runtime secrets will be injected later by Yandex Lockbox and are outside this iteration.

---

# Part C — Unified FastAPI + React production serving

## C1. Static frontend serving

Extend the FastAPI application so the same process serves the built React application in production.

Required behavior:

```text
GET /                     → React index.html
GET /assets/...           → built static assets
GET /api/health           → existing JSON health response
GET /api/seed             → existing seed JSON
POST /api/...              → existing API behavior
```

The API routers must remain authoritative and must not be shadowed by a SPA fallback.

## C2. Local development compatibility

The current development workflow must remain valid:

- backend can still run independently on port 8000;
- Vite can still run independently on port 5173 with `/api` proxying;
- absence of a production frontend build must not prevent backend development/tests from starting;
- no user should be required to build the frontend merely to run backend unit tests.

Use an explicit production static directory contract, a robust path derived from the installed/runtime layout, or an equivalent contained mechanism.

## C3. SPA fallback

Unknown non-API browser paths should return the React entry point when production assets are present, so a direct browser refresh remains valid.

Unknown API paths must not return HTML pretending to be a successful SPA route. They must preserve normal API 404 semantics.

At minimum verify:

```text
GET /some-client-route       → index.html
GET /api/unknown-endpoint    → API 404, not index.html
```

## C4. Asset behavior

Verify:

- built JavaScript and CSS assets are reachable with correct content types;
- the index references assets that actually exist inside the image;
- the browser does not depend on Vite development server in production;
- frontend requests use same-origin `/api` paths, with no hardcoded localhost production dependency.

Do not add a separate Nginx layer unless a real technical blocker is established and documented. The accepted architecture is one FastAPI/Uvicorn process serving both API and the small SPA.

---

# Part D — Runtime configuration

## D1. Environment variables

The container must support the existing runtime variables:

```text
YANDEX_CLOUD_API_KEY
YANDEX_CLOUD_FOLDER_ID
AI_MODEL
AI_BASE_URL
PORT
```

Rules:

- `PORT` controls the listening port;
- Qwen provider configuration remains request-scoped as currently designed;
- the container may start and serve `/`, `/api/health` and `/api/seed` without AI credentials;
- `/api/chat` without required AI configuration must keep the existing handled provider-configuration response rather than crashing the process;
- no values are hardcoded specifically for the user's Yandex folder in the image.

## D2. Process behavior

The production container must:

- start one Uvicorn process;
- log to stdout/stderr;
- stop cleanly when Docker sends termination;
- avoid development reload mode;
- avoid exposing local filesystem paths or secrets in normal startup logs.

A Docker `HEALTHCHECK` is optional. If added, implement it without pulling a large extra runtime dependency solely for health probing.

---

# Part E — Local Docker smoke automation

## E1. PowerShell smoke script

Create:

```text
infra/docker/smoke.ps1
```

The script must provide a repeatable local production smoke flow for Windows PowerShell.

Expected default sequence:

1. verify that the Docker CLI is available;
2. verify that the Docker daemon responds;
3. build the root Dockerfile with a local tag such as `ai-gantt-planner:local`;
4. start a uniquely named detached container on an available/configurable host port;
5. wait for application readiness with a bounded timeout;
6. verify the production frontend and core API;
7. stop and remove the temporary container in `finally`, including when a check fails;
8. print a concise PASS/FAIL summary without printing secret values.

Recommended parameters:

```text
-ImageTag
-Port
-EnvFile       optional, local ignored file only
-SkipBuild
-KeepContainer optional troubleshooting switch
```

Do not require an environment file for the baseline smoke.

## E2. Required smoke checks

The script must verify at minimum:

- `GET /` returns HTTP 200 and production HTML;
- HTML identifies the AI Gantt Planner application;
- at least one referenced built asset is reachable;
- `GET /api/health` returns `{ "status": "ok" }`;
- `GET /api/seed` returns the expected seven-task seed structure;
- `GET /api/unknown-endpoint` is not served as React HTML;
- container logs contain no immediate unhandled startup traceback;
- the container remains running until intentional cleanup.

AI provider invocation is not required for the no-secret baseline smoke. Live AI is tested later in deployed production validation.

## E3. Docker unavailable

Do not install Docker Desktop or modify host-level Docker settings automatically.

If Docker is not installed or the daemon is unavailable:

- still implement all containerization files and automated non-Docker tests;
- do not claim the image was locally verified;
- report the exact blocker and the command the user must run after Docker is available;
- do not begin Yandex Cloud work.

---

# Part F — Automated regression coverage

Add focused tests for production static serving without making ordinary backend tests depend on a previously built frontend.

Verify at minimum:

1. API health/seed routes continue to win over the SPA fallback.
2. A temporary/static production directory serves `index.html` and assets.
3. A non-API client route falls back to `index.html` when assets exist.
4. An unknown `/api/*` route remains a 404 API response, not HTML.
5. Missing production assets do not break backend-only development/test startup.
6. Existing API, Excel, AI/MCP, scheduling and frontend suites remain unchanged and green.

Where practical, add a production-runtime Playwright smoke against the running Docker container, but do not duplicate the entire Iteration 04.6 browser suite inside this iteration. A contained baseline covering page load, seed and one modal interaction is sufficient.

---

# Part G — Repository documentation

Update the root `README.md` only as needed for this completed step:

- remove/replace the statement that Docker is still deferred;
- add local Docker build and run commands;
- explain that `.env` remains runtime-only and ignored;
- explain that one container serves both React and FastAPI;
- state clearly that Yandex Cloud deployment remains the next iteration and is not yet performed.

A final reviewer-oriented README rewrite, architecture diagram, sample packaging and Roadmap remain Iteration 05.4. Do not perform that larger documentation pass now.

No README or documentation file is deployed as a separate cloud website; documentation remains in GitHub.

---

# Required verification

Run all checks that are available in the environment:

## Existing application checks

- full backend suite;
- Python dependency check;
- full frontend unit/integration suite;
- frontend lint;
- TypeScript/production build;
- relevant Playwright baseline;
- `git diff --check`.

## Container checks

When Docker is available:

- `docker build` from repository root;
- local container startup with default `PORT=8080` fallback;
- local container startup with a non-default `PORT` value or equivalent runtime-port verification;
- `infra/docker/smoke.ps1` complete PASS;
- inspect running user and confirm the application is not running as root;
- inspect image history/build output sufficiently to ensure no secret/local `.env` was copied;
- stop/remove temporary containers and avoid leaving dangling named test containers.

Do not require a vulnerability scanner that is unavailable locally, but run any already available standard Docker image inspection without adding a paid service.

---

# Acceptance criteria

Iteration 05.1 is accepted only when:

- one root Dockerfile builds the complete application from a clean repository context;
- one production container serves React and every existing FastAPI endpoint on the same origin;
- the container listens on runtime `PORT`;
- local development remains unchanged;
- no secrets are baked into the image or build context;
- the runtime process is non-root;
- the PowerShell smoke script is idempotent and cleans up after itself;
- root, assets, health and seed work through the container;
- API 404 is not swallowed by SPA fallback;
- existing automated suites remain green;
- README contains accurate local Docker instructions;
- one implementation commit is created and the worktree is clean;
- no Yandex Cloud resource has been created or modified.

# Handoff

Report:

- Dockerfile stages and runtime layout;
- static-serving approach;
- files changed;
- test/build/container smoke results;
- local image tag and container command used;
- confirmation that secrets were not included;
- Docker availability or any exact blocker;
- branch, commit and clean status.

Then stop for Human QA. Do not begin Iteration 05.2, Yandex Cloud bootstrap, registry creation, Lockbox configuration or deployment.
