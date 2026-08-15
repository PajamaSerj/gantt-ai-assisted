# Iteration 05.2 — Yandex Cloud deployment automation

Status: READY FOR IMPLEMENTATION  
Base commit: `4c3b67cc8a8528b67da4d900022e7acc272891c0`  
Source of truth: `docs/AI_Gantt_Planner_Master_Brief_v1.3.md`

## Purpose

Create a safe, repeatable PowerShell + `yc` CLI deployment workflow for the accepted single-image production runtime.

This iteration creates automation code and validates it in read-only / plan mode. It must **not create or modify Yandex Cloud resources automatically during Codex implementation**. After Human review, the user will run the scripts explicitly to bootstrap and deploy.

## Accepted cloud architecture

```text
Public HTTPS URL
        ↓
Yandex Serverless Container
        ├─ FastAPI /api/*
        └─ React SPA / and assets

Docker image storage:
Yandex Container Registry

AI provider:
Yandex AI Studio / Qwen

Secret delivery:
Yandex Lockbox secret version
        ↓
YANDEX_CLOUD_API_KEY environment variable

Runtime identity:
Dedicated service account (default name: gantt-ai)
```

The application remains stateless. Do not add a database, Object Storage, API Gateway, VM, Kubernetes, Terraform, GitHub Actions deployment, custom domain or separate frontend hosting.

## Current official platform contracts to preserve

- A Serverless Container revision is deployed from an image stored in Yandex Container Registry.
- A private registry image requires a revision service account with image-pull permission.
- The principal deploying a revision with a service account must be allowed to use that service account.
- A newly deployed revision becomes active; old revisions remain available for rollback.
- Public invocation is enabled explicitly with `allow-unauthenticated-invoke`.
- Lockbox secrets are attached while deploying a new revision using secret ID, version ID, key and target environment-variable name.
- Lockbox secret attachment is currently a Preview feature; scripts and docs must state this without inventing an alternative secret path.

Do not hardcode assumptions that contradict the installed `yc` CLI. Scripts must check command availability/help and fail with a precise message when the local CLI contract differs.

---

# Deliverable structure

Create:

```text
infra/yandex/
├─ config.example.psd1
├─ common.ps1
├─ bootstrap.ps1
├─ deploy.ps1
├─ smoke.ps1
├─ rollback.ps1
└─ README.md
```

Add local files to `.gitignore`:

```text
infra/yandex/config.psd1
infra/yandex/*.local.json
infra/yandex/.state/
```

Do not commit cloud IDs tied to the user's account unless they are already public product configuration and Human explicitly approves. The committed example must use placeholders.

## PowerShell compatibility

All scripts must run in Windows PowerShell 5.1 and PowerShell 7.

- Do not require `pwsh`.
- Avoid PowerShell-7-only syntax.
- Load `System.Net.Http` explicitly when required.
- Handle native stderr without turning normal `yc`, Docker or Uvicorn informational output into a false terminating error.
- Use UTF-8 safely on Windows.
- Quote Windows paths correctly.

---

# Part A — Configuration

## A1. `config.example.psd1`

Provide a documented template similar to:

```powershell
@{
    FolderId = '<folder-id>'

    RegistryName = 'ai-gantt-planner'
    RepositoryName = 'ai-gantt-planner'
    ContainerName = 'ai-gantt-planner'
    ServiceAccountName = 'gantt-ai'

    LockboxSecretName = 'ai-gantt-planner-qwen'
    LockboxSecretKey = 'api-key'

    Cores = 1
    Memory = '512MB'
    ExecutionTimeout = '60s'
    Concurrency = 1

    AiModel = 'gpt://<folder-id>/qwen3.6-35b-a3b'
    AiBaseUrl = 'https://ai.api.cloud.yandex.net/v1'
    Public = $true
}
```

The exact Qwen model string remains configurable. Do not silently switch providers or models.

`config.psd1` contains only non-secret names/IDs/settings. It must never contain the API-key value.

## A2. Validation

Validate at minimum:

- config file exists;
- FolderId is non-empty;
- names satisfy basic Yandex naming constraints;
- cores/memory/timeout/concurrency are valid;
- AiModel and AiBaseUrl are non-empty;
- no property resembling API key value/token/password/secret payload is present.

---

# Part B — Shared helpers

`common.ps1` should contain contained reusable functions for:

- locating repository root;
- loading and validating config;
- checking `yc`, Docker and Git;
- running native commands while preserving exit codes and readable output in PowerShell 5.1;
- reading `yc --format json` safely;
- resolving resources by exact name in the configured folder;
- printing a redacted plan;
- explicit confirmation / `-Apply` guard;
- Git SHA/image tag calculation;
- HTTP smoke helpers;
- preventing accidental secret output.

Never print environment-variable values for names matching key/token/password/secret.

---

# Part C — Bootstrap

## C1. Default behavior is read-only plan

`bootstrap.ps1` must default to inspection/plan mode.

Example:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
    -File .\infra\yandex\bootstrap.ps1 `
    -Config .\infra\yandex\config.psd1
```

In plan mode it may run only read-only commands and must report:

- active `yc` profile;
- configured/current folder ID and mismatch;
- Docker availability;
- Container Registry status;
- service account status;
- required role status where it can be inspected;
- Serverless Container status;
- Lockbox secret metadata and active version/key status;
- whether Docker credential helper is configured or needs configuration;
- exact actions `-Apply` would perform.

It must not create resources, change IAM, make a container public or modify Docker configuration in plan mode.

## C2. Explicit apply

Mutations require `-Apply` and an explicit confirmation unless `-Force` is also supplied.

Apply mode may idempotently:

1. create the registry if missing;
2. find or create the runtime service account if missing;
3. ensure least-privilege runtime access:
   - `ai.languageModels.user` for the configured folder;
   - `container-registry.images.puller` scoped to the registry where supported;
   - `lockbox.payloadViewer` scoped to the configured secret where supported;
4. create the Serverless Container metadata if missing;
5. create Lockbox secret metadata if missing **only if this can be done without putting a secret value in command history/process arguments**;
6. configure the Yandex Docker credential helper after explicit confirmation;
7. make the container public only when `Public = $true` and the user explicitly applies the plan.

## C3. Secret-value safety boundary

The automation must never accept the Qwen API key as:

- a script parameter;
- a config value;
- a command-line `--payload` plaintext value;
- a committed or persistent temporary file;
- console output.

If the secret or active version/key is missing, bootstrap must stop after safe resource creation and print a short manual handoff for adding one custom Lockbox entry in the Yandex Cloud console:

```text
key: api-key
value: <existing Yandex AI Studio API key>
```

After the user adds it, plan mode must detect the active version and key without reading or printing the payload value.

Do not retrieve the API-key payload using `yc lockbox payload get`.

## C4. IAM safety

- Do not grant broad roles such as `admin`, `editor` or `resource-manager.admin`.
- Do not alter unrelated bindings.
- Do not create a deployment service account in this iteration.
- Do not automatically grant new permissions to the current user/principal; report a clear blocker if the caller lacks `iam.serviceAccounts.user` or another required permission.
- Re-running bootstrap must not create duplicate resources or duplicate effective bindings.

---

# Part D — Deploy

## D1. Default behavior

`deploy.ps1` is mutating and requires `-Apply`.

Without `-Apply`, it prints a redacted deployment plan only.

## D2. Preflight

Before deployment:

- validate config;
- require `yc`, Docker and a running Docker daemon;
- verify current `yc` folder or pass `--folder-id` explicitly to every command;
- verify registry, container, service account and active Lockbox secret version/key exist;
- verify Git worktree is clean by default; permit override only with explicit `-AllowDirty`;
- obtain the current short Git SHA;
- verify Docker credential helper access to `cr.yandex`;
- never expose secret values.

## D3. Build and local gate

Default deploy flow:

1. run the accepted local container smoke using an immutable local image tag based on Git SHA;
2. stop if local container smoke fails;
3. tag the image as:

```text
cr.yandex/<registry-id>/<repository-name>:<short-git-sha>
```

Optionally also publish `:latest`, but the Serverless Container revision must reference the immutable SHA tag.

Allow `-SkipLocalSmoke` only as an explicit exceptional override.

## D4. Push and revision

After successful local gate:

1. push the immutable image tag to Yandex Container Registry;
2. deploy a new Serverless Container revision with configurable resources;
3. attach the configured runtime service account;
4. set only non-secret environment variables:
   - `YANDEX_CLOUD_FOLDER_ID`;
   - `AI_MODEL`;
   - `AI_BASE_URL`;
5. attach Lockbox secret key to environment variable `YANDEX_CLOUD_API_KEY` using secret ID, active version ID and configured key;
6. do not override the image `CMD` unless technically required;
7. make/keep the container public when configured;
8. retrieve and print the public HTTPS URL and new revision ID;
9. run cloud smoke;
10. print rollback command for the previous revision when one exists.

Use `yc serverless container revision deploy`. Preserve previous immutable revisions.

## D5. Failure behavior

- Never delete the previous revision/image on deployment failure.
- If push succeeds but revision deploy fails, report the orphan image tag; do not delete automatically.
- If revision deploy succeeds but smoke fails, keep the previous revision available and print the exact rollback command.
- Do not automatically rollback without explicit Human instruction.
- Exit non-zero on any failed gate.

---

# Part E — Cloud smoke

`smoke.ps1` accepts a public URL or resolves it by container name.

Default checks:

- `GET /` returns the application shell;
- referenced JS/CSS asset returns 200;
- `GET /api/health` returns `{ status: 'ok' }`;
- `GET /api/seed` returns seven demo tasks;
- unknown `/api/*` returns JSON 404, not SPA HTML;
- no authentication header is required;
- URL is HTTPS;
- responses complete within a bounded retry window suitable for cold start.

Add optional `-LiveAi` mode, not enabled by default, which:

1. fetches the seed;
2. posts one read-only Russian request to `/api/chat`;
3. verifies the response is not `provider_error` and does not mutate the plan;
4. never prints provider credentials.

No video or committed smoke artifacts.

---

# Part F — Rollback

`rollback.ps1` must:

- require config and explicit `-RevisionId`;
- list revisions in read-only mode when no revision ID is supplied;
- show current active revision and target revision;
- require `-Apply` and confirmation before activation;
- activate the selected immutable revision using the current official `yc` rollback command;
- run cloud smoke after activation;
- never delete revisions or images.

Document that revision activation/rollback preserves resource history.

---

# Part G — Documentation

`infra/yandex/README.md` must explain, in order:

1. architecture;
2. prerequisites (`yc init`, Docker running, permissions);
3. copy `config.example.psd1` to ignored `config.psd1`;
4. plan-only bootstrap;
5. apply bootstrap;
6. one manual Lockbox value step when needed;
7. re-run plan and verify readiness;
8. deploy plan;
9. deploy apply;
10. cloud smoke and optional live AI smoke;
11. rollback;
12. cost-conscious cleanup after review;
13. security model and what is never committed.

State explicitly that README remains in GitHub; it is not deployed as product documentation.

Do not add raw user-specific IDs, API keys, screenshots with private cloud details or generated CLI output to the repository.

---

# Automated verification

Add contained tests/contract checks for the scripts. At minimum verify:

- PowerShell parser accepts every `.ps1` file under Windows PowerShell 5.1;
- plan mode contains no mutating `yc`/Docker-config command execution path;
- every mutating entry point requires `-Apply`;
- no config/script accepts or contains an API-key value;
- secret payload retrieval is absent;
- no broad IAM roles are granted;
- deploy uses immutable Git-SHA image tag;
- deploy references Lockbox by ID/version/key;
- Docker smoke is called before push by default;
- previous revision is not deleted;
- rollback requires revision ID + Apply;
- cloud smoke checks same-origin frontend/API and unauthenticated HTTPS;
- scripts use explicit folder scope;
- local config/state paths are ignored by Git.

Use mocks/static contract tests for mutating commands. Codex must not create real cloud resources during this iteration.

## Read-only local validation

Codex may run only read-only commands such as:

```text
yc version
yc config list
yc container registry list
yc iam service-account list
yc serverless container list
yc lockbox secret list
yc serverless container revision list
```

Only when the local environment has a configured `yc` profile. Do not treat missing `yc` as permission to install it or start cloud setup automatically.

---

# Verification gate

Run:

- backend full suite;
- frontend unit/integration suite;
- frontend lint;
- TypeScript + production build;
- Playwright suite;
- local Docker smoke;
- PowerShell 5.1 syntax/parser checks for all new scripts;
- deployment script contract tests;
- bootstrap in plan mode if `yc` is available;
- `git diff --check`;
- clean `git status`.

Report clearly:

- scripts created;
- read-only cloud state detected, if any;
- resources that plan mode proposes;
- any missing local prerequisite or permission;
- commit SHA and final clean status.

Create one implementation commit and stop for Human review. Do not run bootstrap with `-Apply`, push an image to Yandex, deploy a revision, modify IAM, create a Lockbox payload, or start Iteration 05.3.