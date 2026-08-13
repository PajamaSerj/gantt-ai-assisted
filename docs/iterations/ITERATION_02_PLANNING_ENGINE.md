# Iteration 02 — Planning Engine

**Status:** READY  
**Depends on:** Iteration 01 ACCEPTED  
**Source of truth:** `docs/AI_Gantt_Planner_Master_Brief_v1.3.md`

## Goal

Implement the deterministic planning engine required before MCP/LLM/UI integration: Excel import/export, Replace/Append flows, ChangeSet preparation, final-state validation, transitive impact analysis and guarded apply.

Do not change product/business rules from the Master Brief. If implementation requires such a change, stop and return the conflict instead of deciding silently.

## Scope

### 1. Excel import

Implement `.xlsx` import with `openpyxl`.

Process only the active worksheet.

Required input columns:

- `задача`
- `описание`
- `исполнитель`
- `длительность`
- `предшественники`

Rules:

- normalize header case/whitespace;
- ignore unknown extra columns;
- ignore fully blank rows;
- task name is required and unique;
- `;` is forbidden in task names because it is reserved as the canonical predecessor separator; escaping/quoting is not supported;
- duration is a positive integer;
- description, assignee and predecessors are optional;
- canonical separator for multiple predecessors is `;`;
- predecessor names are resolved to internal UUIDs;
- validate unknown predecessor, self-reference and cycles;
- collect all import errors in one response where practical;
- import is atomic: any validation error means `0 changes applied`.

### 2. Replace mode

Input: Excel file + plan start date.

Behavior:

- validate complete incoming plan;
- generate `TASK-001`, `TASK-002`, ... in valid Excel row order;
- calculate schedule using existing Monday–Friday / Finish-to-Start rules;
- if plan start date is a weekend, prepare normalization to the next working day and require preview/confirmation according to the Master Brief;
- do not mutate the current PlanState before successful validation and any required confirmation.

### 3. Append mode

Input: Excel file + current PlanState + minimum allowed start date.

Rules:

- incoming predecessor may reference an incoming task or an existing task;
- resolve against the union of current + incoming tasks;
- validate name uniqueness across the full resulting plan;
- validate the combined dependency graph and cycles;
- new public IDs start at `max(existing TASK number) + 1`;
- existing IDs are never renumbered;
- schedule incoming tasks from `max(minimum allowed date, dependency constraint)`;
- weekend normalization follows the same preview/confirmation rule;
- all resulting impacts are shown in one consolidated preview, not sequential confirmations.

### 4. ChangeSet

Implement transient ChangeSet behavior aligned with the Master Brief.

Conceptually it contains:

- requested changes;
- affected tasks;
- conflicts;
- proposed impacts;
- status.

Preparing a ChangeSet must not mutate the source PlanState.

### 5. Final-state batch validation — critical

For batch/mass changes, do not validate each requested mutation as a separate committed intermediate state.

Required flow:

1. collect requested changes;
2. build one proposed final PlanState in memory;
3. validate the complete proposed final state;
4. calculate schedule consequences and transitive impacts;
5. classify result;
6. apply only when authorized.

Validate at least:

- unique task names;
- dependency references;
- self-reference;
- cycles;
- scheduling validity.

### 6. Impact analysis — critical

Impact calculation must be deterministic and transitive across the downstream dependency graph.

For `A -> B -> C -> D`, a change to A must continue checking B, C and D until the full affected chain is known.

Each proposed impact must expose enough data for later UI preview:

- public TASK-ID;
- task name;
- current start/end;
- proposed start/end;
- reason;
- dependency that caused the impact.

If multiple tasks are affected, return one consolidated impact set.

Do not silently apply caused shifts before confirmation.

### 7. No implicit optimization

Preserve these rules exactly:

- removing a dependency does not automatically pull a successor earlier;
- shortening a predecessor does not automatically pull successors earlier;
- a request that conflicts with a predecessor constraint must not move the predecessor automatically;
- calculate only changes necessary to preserve validity, not schedule optimization;
- optimization is a separate explicit user request and is not part of this iteration.

### 8. Classification and apply guard

Support at least:

- `AUTO_APPLICABLE`
- `CONFIRMATION_REQUIRED`

If any requested change produces a conflict or confirmation-required impact, no part of that ChangeSet is applied before user choice.

The apply path must revalidate against the current PlanState before final mutation.

A later explicit partial-apply choice may be supported only by revalidating the selected subset; do not silently apply valid items from a mixed ChangeSet.

### 9. Excel export

Export current PlanState to `.xlsx` with columns:

- `ID`
- `задача`
- `описание`
- `исполнитель`
- `длительность`
- `дата начала`
- `дата окончания`
- `предшественники`

Rules:

- export `TASK-NNN`, never UUID;
- predecessors are exported by task names;
- file must open in Excel-compatible software;
- exported file must be compatible with the normal MVP re-import contract; extra ID/date columns may be ignored on re-import.

### 10. API

Add the backend API/services needed for this iteration, including:

- `POST /api/import`
- `POST /api/changesets/apply`
- `POST /api/export`

Backend remains stateless. Current PlanState is supplied with the request where needed. Do not add DB/session persistence.

## Minimum tests

Cover at least:

- valid `.xlsx`;
- missing/invalid columns;
- invalid duration;
- duplicate names;
- unknown predecessor;
- self-reference;
- cycle;
- Append reference to existing task;
- Append duplicate across current + incoming;
- Replace/Append TASK-ID generation;
- weekend normalization;
- atomic import;
- valid/conflicting batch ChangeSet;
- final-state batch validation;
- transitive downstream impacts;
- consolidated impact preview;
- no implicit successor pull-forward;
- confirmation-required state remains unapplied;
- revalidation before apply;
- export;
- export -> normal MVP re-import.

Run the full existing backend suite as regression protection and run frontend lint/build to ensure Iteration 01 frontend still works.

## Explicitly out of scope

Do not implement in Iteration 02:

- MCP;
- LLM / Qwen;
- `/api/chat`;
- AI assistant UI;
- Frappe Gantt;
- final UI polish;
- Yandex AI Studio integration;
- Yandex Cloud deployment;
- Docker deployment;
- authentication;
- database;
- CI/CD;
- production Roadmap features.

## Completion / handoff

Before coding:

- inspect repository state;
- confirm Iteration 01 baseline is present;
- read the Master Brief sections relevant to this scope;
- stop on any product/business conflict.

After implementation:

- run tests/checks;
- inspect git diff/status;
- remove temporary/debug artifacts;
- create one clear Iteration 02 commit;
- return: implemented scope, changed files, tests, git status/commit, deviations/assumptions, blockers/open questions;
- stop and do not begin Iteration 03.
