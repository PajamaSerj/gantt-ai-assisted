# Iteration 05.4 — Submission Packaging

Status: APPROVED FOR IMPLEMENTATION  
Product state: FEATURE FREEZE  
Production URL: `https://bbaqdcimsde8vli202gq.containers.yandexcloud.net/`  
Source of truth: `docs/AI_Gantt_Planner_Master_Brief_v1.3.md` and `docs/source/test_task.pdf`

## Context

Iteration 05.3 production validation is accepted by Human QA:

- public HTTPS application opens without authentication;
- Gantt renders and direct manipulation works;
- live Qwen request works in production;
- automated cloud smoke with `-LiveAi` passed;
- Excel import passed;
- AI preview Cancel/Apply passed;
- Excel export passed;
- browser persistence after F5 passed.

The product implementation is frozen. This iteration is for reviewer-facing packaging, required submission artifacts, and final repository hygiene only.

## Goal

Turn the working deployed product and repository into a concise, self-contained test-task submission that satisfies the original assignment without adding product features.

## Required deliverables

### 1. Reviewer-first root README

Rewrite the root `README.md` for an external reviewer. The first screen should answer:

- what AI Gantt Planner is;
- live demo URL;
- core capabilities;
- stack;
- where to find the demo media and sample Excel.

The README must still include:

- local backend/frontend run instructions;
- production Docker run instructions;
- architecture and key decisions;
- deterministic backend vs LLM responsibilities;
- real MCP usage and tool boundary;
- Excel input contract;
- deployment summary;
- test/QA summary;
- known MVP limitations;
- Roadmap link;
- AI-assistant usage disclosure.

Do not present the repository as an iteration log. Remove obsolete wording such as "implemented through Iteration 5.2" from the reviewer-facing introduction.

Use the confirmed production URL exactly:

`https://bbaqdcimsde8vli202gq.containers.yandexcloud.net/`

### 2. Architecture documentation

Create `docs/ARCHITECTURE.md` with a compact architecture explanation and Mermaid diagram covering:

```text
Browser / React + Frappe Gantt
        ↓ same origin
FastAPI
├─ deterministic planning/import/export/ChangeSet logic
├─ MCP client/server boundary
└─ LLM orchestration
        ↓
Yandex AI Studio / Qwen

Deployment:
Docker image → Yandex Container Registry → Yandex Serverless Containers
Secret: Yandex Lockbox → runtime env only
```

Explicitly document why the LLM does not own dates, graph integrity, cycle checks, Excel parsing, or implicit scheduling decisions.

### 3. Roadmap to Production

Create `docs/ROADMAP_TO_PRODUCTION.md`.

It must clearly distinguish deliberate MVP technical debt from defects and prioritize production work, including at minimum:

1. persistent database / plan storage;
2. users, authentication and workspaces;
3. versioning/history/audit/concurrency;
4. observability, rate limiting, cost controls and provider resilience;
5. CI/CD and production deployment hardening;
6. advanced scheduling: holiday calendars, richer dependencies, milestones, capacity/resource leveling;
7. stable import/re-import identifiers and larger Excel workflows;
8. advanced AI/document intake only after deterministic contracts are preserved.

Include main production risks and recommended implementation order.

### 4. Sample Excel

Create and commit:

`sample/sample_tasks.xlsx`

The workbook must be fully self-contained and valid for Replace import. Use the canonical required columns:

- `задача`
- `описание`
- `исполнитель`
- `длительность`
- `предшественники`

Include a useful non-trivial example with parallel tasks and multiple predecessors. Do not depend on demo-plan task names.

Generate the `.xlsx` deterministically with `openpyxl` or equivalent project dependency and validate it through the real `/api/import` logic in Replace mode.

No invalid sample workbook is required for submission.

### 5. Demo artifact preparation

The original assignment requires a video or GIF showing:

```text
Excel upload → chat edit → export
```

Create `docs/demo/README.md` with a short recording script for the Human operator and the intended final media path, for example:

`docs/demo/ai-gantt-demo.gif` or `docs/demo/ai-gantt-demo.mp4`

Do not fabricate or pre-record a fake-provider demo. The final media must show the real reviewer-facing product. If a real production recording cannot be created inside the Codex environment, leave the documented recording slot ready and report it as the only Human packaging step.

The recommended demo should be short (roughly 30–60 seconds) and show only the required flow plus visible Gantt changes.

### 6. AI-assistant usage disclosure

Add a concise section to the root README. Use factual wording close to:

> AI-ассистенты использовались для реализации отдельных компонентов, scaffolding, code review, тестов и документации. Архитектура, бизнес-правила, системная модель и границы MVP были определены и зафиксированы до основной реализации.

Also mention that final behavior was verified through automated tests and Human QA. Do not claim fully manual implementation and do not frame the product as autonomously generated by AI.

### 7. Final requirement matrix

Create `docs/SUBMISSION_CHECKLIST.md` mapping each original source requirement to concrete evidence in the repository or deployed product.

At minimum cover:

- seeded interactive Gantt;
- Excel upload;
- adjacent AI chat;
- mass task moves;
- dependency changes;
- task creation;
- assignee redistribution;
- immediate Gantt reflection / preview + Apply contract;
- task modal;
- Excel export;
- React;
- Python/FastAPI;
- MCP;
- LLM API;
- required Excel columns;
- git repository;
- deployed application;
- README/local run;
- architecture/decisions;
- AI-assistant usage;
- demo;
- sample Excel;
- Roadmap to Production.

Mark only the actual media recording as `HUMAN PENDING` if it is not yet committed. Do not mark implemented functionality as complete unless concrete evidence exists.

## Repository hygiene

Perform a submission-oriented audit for:

- committed secrets or credentials;
- local config/state;
- temporary screenshots/videos/logs;
- stale generated output;
- obsolete README statements;
- broken relative links;
- accidental Pajama Tech product branding in the test application or reviewer-facing docs.

Do not remove source requirements, iteration history, QA evidence, or other useful files merely to make the repository smaller. If a file is questionable rather than clearly disposable, report it instead of deleting it.

The product itself must remain branded only as `AI Gantt Planner`.

## Feature freeze

Do not change product behavior unless packaging exposes a true submission blocker.

Do not change:

- scheduling/domain rules;
- AI semantics;
- MCP architecture;
- Gantt UX;
- Excel behavior;
- Yandex infrastructure;
- IAM/Lockbox configuration;
- deployment architecture.

## Verification

Before committing:

- backend full test suite;
- frontend unit/integration tests;
- frontend lint;
- frontend production build;
- Playwright suite;
- packaging/sample Excel validation;
- Markdown relative-link audit where practical;
- secret-pattern/repository hygiene scan without printing secret values;
- `git diff --check`;
- clean worktree after commit.

Do not redeploy production during this iteration unless a real submission blocker requires a code change.

## Completion contract

Create one packaging commit and stop for Human review.

Report:

- commit SHA;
- files added/changed;
- tests/checks;
- requirement matrix status;
- whether demo media is the only remaining Human step;
- any repository hygiene concerns that require Human decision.

Do not begin new product features after completion.
