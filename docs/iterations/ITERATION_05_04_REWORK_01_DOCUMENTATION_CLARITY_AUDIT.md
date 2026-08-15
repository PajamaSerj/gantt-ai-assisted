# Iteration 05.4 — Rework 01: Documentation clarity + reviewer audit

**Status:** REWORK  
**Base commit:** `ecaefd09ccff9242c9bf3e545e282e3a6122b7fa`  
**Source of truth:** `docs/AI_Gantt_Planner_Master_Brief_v1.3.md`  
**Scope:** documentation only

## Goal

Improve the final submission documentation so that a reviewer can understand the product, architecture, deliberate MVP trade-offs and production roadmap without needing to decode internal engineering jargon.

The product itself is accepted and frozen. This rework is not a technical redesign and not a feature iteration.

The desired result is documentation that is:

- technically accurate;
- understandable to a BA/SA/product-oriented reviewer;
- concise enough to scan quickly;
- professional without sounding like generated architecture prose;
- explicit about what the MVP does, what it deliberately does not do, and why.

## First step: audit before editing

Before changing files, review the current reviewer-facing documentation as one package:

1. `README.md`
2. `docs/ROADMAP_TO_PRODUCTION.md`
3. `docs/ARCHITECTURE.md`
4. `docs/SUBMISSION_CHECKLIST.md`
5. `docs/demo/README.md`
6. `docs/AI_Gantt_Planner_Master_Brief_v1.3.md` only as the source of truth for product rules
7. `docs/source/test_task.pdf` only to verify that final required submission artifacts remain covered

Audit for:

- wording that is technically correct but difficult to understand;
- excessive mixing of Russian and English where a clear Russian phrase is available;
- internal implementation language that does not help a reviewer;
- statements that may be misunderstood as stronger production guarantees than the MVP actually provides;
- duplicate explanations across README / architecture / roadmap;
- missing or weak explanation of deliberate technical debt;
- anything in the final package that sounds like an internal Codex/iteration report rather than final submission documentation.

Do not silently change product meaning while simplifying wording.

## User feedback that must be addressed

The following current formulations were explicitly unclear and should be replaced with plain-language equivalents.

### 1. Batch / final PlanState

Current idea:

> batch проверяется как единый proposed final PlanState

Meaning to preserve:

> Если одна команда меняет несколько задач, backend сначала рассчитывает итоговый план целиком и только затем проверяет его на ошибки и конфликты.

Do not require the reviewer to know the term `proposed final PlanState` in the README.

### 2. Pending ChangeSet lock

Current idea:

> pending ChangeSet блокирует другие мутации до Apply, Cancel или Restore

Meaning to preserve:

> Пока пользователь рассматривает preview изменений, другие изменения плана временно недоступны. Сначала нужно применить или отменить текущие изменения либо восстановить демо.

Explain the reason briefly if useful: otherwise the preview could stop matching the plan it was calculated for.

### 3. Stateless backend / storage

Current idea:

> backend stateless, постоянного server-side storage в MVP нет

Meaning to preserve:

> В MVP текущий план хранится в `localStorage` браузера. Backend получает актуальный план с каждым запросом, проверяет или изменяет его и возвращает обратно, но не хранит пользовательский план между запросами.

Do not imply durable, shared or cross-device storage.

### 4. Frappe Gantt boundary

Current idea:

> Frappe Gantt — visualization layer, а не источник scheduling logic

Meaning to preserve:

> Frappe Gantt отвечает за отображение диаграммы и взаимодействие с ней. Правила рабочих дней, дат и зависимостей рассчитывает Python backend.

## README — required editorial direction

Keep the current reviewer-first structure and production URL near the top. The README is broadly successful and should not be rewritten from scratch.

Simplify the section about architecture / key decisions. Prefer plain explanations over terms such as:

- proposed final state;
- pending mutation;
- atomicity;
- re-validation;
- impact propagation;
- MCP tool arguments;
- deterministic drag/resize;
- visualization layer.

Technical terms may remain when they are useful, but the sentence must still be understandable without specialist context.

### LLM vs backend table

Replace or substantially simplify the current table. Preferred conceptual structure:

| AI понимает пользователя | Backend проверяет правила |
| --- | --- |
| что пользователь хочет изменить | допустимы ли новые даты |
| какие задачи он имеет в виду | не появились ли циклы в зависимостях |
| какое действие нужно подготовить | корректен ли Excel |
| когда нужно задать уточняющий вопрос | какие ещё задачи затронет изменение |
| как объяснить результат пользователю | можно ли безопасно применить итоговый план |

Then explain the principle in one short paragraph:

> AI интерпретирует намерение пользователя, но не решает самостоятельно, какие даты и зависимости допустимы. Финальную проверку всегда выполняет backend.

This is a wording direction, not a requirement to copy verbatim if a clearer equivalent is produced.

Other phrases worth reviewing:

- `read-only карточка задачи` → prefer plain Russian;
- `deterministic drag/resize` → explain as user interaction checked by backend;
- `Packaging regression отправляет этот файл...` → rewrite as final documentation, not an internal implementation report;
- reduce unnecessary Russian/English mixing where clarity improves.

## Roadmap to Production — main rework target

The current roadmap is technically rich but too jargon-heavy for the final submission.

Rewrite it substantially in human language while preserving its current strategic order and substance.

A reviewer should be able to answer after reading it:

1. What is deliberately simplified in the MVP?
2. Why is that acceptable for the test assignment?
3. What would be built first for real production use?
4. What risks does each next step close?

Keep approximately these directions, in this order unless the audit finds a strong reason to adjust wording:

1. durable storage + users/access;
2. history/versioning + simultaneous editing safety;
3. monitoring, limits and AI/provider resilience;
4. automated delivery / CI/CD;
5. richer scheduling capabilities;
6. robust Excel re-import + larger plans;
7. advanced AI/document intake only after the operational foundation is ready.

Prefer explanations such as:

> Сейчас планы хранятся только в браузере. В production следующим шагом я бы перенёс их в БД, добавил пользователей, авторизацию и отдельные рабочие пространства. После этого план можно будет безопасно открыть с другого устройства и использовать командой.

rather than dense lists of terms such as `tenant boundaries`, `retention`, `optimistic concurrency`, `idempotency keys`, `circuit breakers`, `promotion`, etc.

Useful technical terms may be added in parentheses after the plain-language explanation, not used as the explanation itself.

The risk table may remain, but it must be understandable without an SRE/platform background.

## ARCHITECTURE.md

Keep this document more technical than the README, including the Mermaid diagram and real component boundaries.

However, simplify:

- Overview;
- Runtime flow;
- explanation of LLM/backend responsibility;
- MVP trade-offs.

The architecture document may still use `PlanState`, `ChangeSet`, MCP, FastAPI, request-scoped context and similar real system terms, but introduce them in understandable sentences rather than stacking multiple terms in one statement.

Do not remove the genuine MCP architecture just to make the document simpler.

## Other final-package documents

Audit `SUBMISSION_CHECKLIST.md` and `docs/demo/README.md` for clarity and consistency, but only edit them if there is a real reviewer-facing problem.

Do not expand the package with new documents unless an actual requirement gap is found.

## Do not change

This rework must not modify:

- application code;
- frontend behavior or visual design;
- backend business rules;
- scheduling semantics;
- Excel import/export logic;
- AI prompts, AI provider, MCP tools or MCP architecture;
- tests except only if a documentation-specific test explicitly requires a path/text update;
- Dockerfile or container build contract;
- Yandex Cloud automation, IAM, Lockbox or deployed infrastructure;
- production URL;
- `sample/sample_tasks.xlsx` unless a genuine submission defect is discovered;
- source requirement PDF;
- Master Brief product decisions.

Do not add features, refactor code, change dependencies, rename APIs or "clean up" implementation while doing this documentation task.

Do not turn README into a huge architecture specification. Its job is to help a reviewer quickly understand and run/evaluate the submission.

Do not hide deliberate MVP limitations. Explain them clearly and neutrally.

Do not overstate test counts, QA results or production readiness beyond evidence already present in the repository.

## Final audit after editing

After edits, read the final documentation package again as if you are the employer reviewing the test assignment for the first time.

Check specifically:

- the product purpose is clear in the first screen of README;
- production demo and sample Excel are easy to find;
- local run instructions remain complete;
- React / FastAPI / MCP / LLM requirements remain explicitly evidenced;
- Excel import/export and AI mass-edit capability are clearly described;
- architecture explains why LLM and deterministic rules are separated;
- deliberate MVP limitations are understandable rather than defensive;
- Roadmap is realistic and ordered, not a jargon catalogue;
- AI-assistant usage wording remains accurate and professional;
- demo requirement is still surfaced;
- no secret or private credential is exposed;
- no Pajama Tech branding is introduced into the test product documentation.

## Expected output

1. Briefly report the documentation audit findings before edits.
2. Edit only the reviewer-facing documentation needed to resolve those findings.
3. Re-read the package and report any remaining concerns.
4. Run lightweight documentation/repository checks that are relevant to the changed files; full application test suites are not required for prose-only changes unless a non-document file was touched.
5. Create one commit for this documentation rework and stop for Human review.

Do not begin another product or deployment iteration after this work.
