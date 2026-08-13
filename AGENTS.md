# Agent instructions

This repository is developed in controlled engineering iterations.

## Sources of truth

1. Product/business/architecture baseline: `docs/AI_Gantt_Planner_Master_Brief_v1.3.md`.
2. Current engineering scope: the iteration brief explicitly named in the user prompt under `docs/iterations/`.
3. Original assignment in `docs/source/` is a completeness check, not a license to override resolved decisions in the Master Brief.

## Working rules

- Read the Master Brief and the named iteration brief before changing code.
- Implement only the current iteration. Do not start later iterations automatically.
- Do not change approved product/business rules or the Master Brief unless the user explicitly approves it.
- If implementation reveals a real conflict or requires a new product/business decision, stop and return the issue instead of choosing silently.
- Technical implementation details may vary only within the boundaries of the Master Brief and current iteration.
- Keep the backend deterministic for scheduling, dependency validation, ChangeSet validation and other formal business rules.
- Do not introduce infrastructure, frameworks or persistence that are explicitly out of scope.
- Never commit secrets, local `.env` values, temporary artifacts, generated caches or local build/install metadata.

## Verification

After code changes:

- run the complete relevant backend test suite;
- run frontend lint/type/build checks when the frontend exists, even if the iteration is backend-focused, to catch regressions;
- inspect `git diff` and `git status`;
- remove temporary/debug artifacts;
- create one clear commit for the completed iteration;
- leave the worktree clean.

## Handoff report

Return:

- implemented scope;
- changed files/modules;
- tests/checks and results;
- branch, commit SHA/message and final git status;
- deviations or assumptions;
- blockers/open questions.

Then stop. Do not begin the next iteration without a new user instruction.
