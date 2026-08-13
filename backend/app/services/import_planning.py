from dataclasses import dataclass
from datetime import date
from enum import StrEnum
from uuid import UUID, uuid4

from app.domain.changesets import (
    AppendPlanChange,
    ChangeSet,
    ChangeSetStatus,
    ReplacePlanChange,
    prepare_changeset,
)
from app.domain.errors import DependencyCycleError, DomainValidationError
from app.domain.graph import topological_order
from app.domain.ids import format_public_id, next_public_id, public_ids_for_replace
from app.domain.models import CreatedSource, PlanState, Task, TaskSpec
from app.domain.validation import validate_plan_schedule
from app.services.excel_import import ImportIssue, ParsedTaskRow, parse_xlsx


class ImportMode(StrEnum):
    REPLACE = "replace"
    APPEND = "append"


@dataclass(frozen=True, slots=True)
class ImportPreparation:
    unchanged_plan: PlanState
    changeset: ChangeSet | None
    issues: tuple[ImportIssue, ...]

    @property
    def status(self) -> str:
        if self.issues:
            return "VALIDATION_FAILED"
        assert self.changeset is not None
        return self.changeset.status.value


def _public_ids(mode: ImportMode, current_plan: PlanState, count: int) -> list[str]:
    if mode is ImportMode.REPLACE:
        return public_ids_for_replace(count)
    first_id = next_public_id(task.public_id for task in current_plan.tasks)
    first_number = int(first_id.removeprefix("TASK-"))
    return [format_public_id(first_number + offset) for offset in range(count)]


def _placeholder_task(spec: TaskSpec) -> Task:
    return Task(
        **spec.model_dump(),
        start_date=date(2000, 1, 3),
        end_date=date(2000, 1, 3),
    )


def _resolve_specs(
    rows: tuple[ParsedTaskRow, ...],
    mode: ImportMode,
    current_plan: PlanState,
) -> tuple[tuple[TaskSpec, ...], tuple[ImportIssue, ...]]:
    issues: list[ImportIssue] = []
    public_ids = _public_ids(mode, current_plan, len(rows))
    row_ids = {row.name.casefold(): uuid4() for row in rows}
    existing_by_name = (
        {task.name.casefold(): task for task in current_plan.tasks}
        if mode is ImportMode.APPEND
        else {}
    )

    for row in rows:
        existing = existing_by_name.get(row.name.casefold())
        if existing:
            issues.append(
                ImportIssue(
                    code="DUPLICATE_TASK_NAME",
                    message=(
                        f"Task name '{row.name}' already exists as "
                        f"{existing.public_id}"
                    ),
                    row=row.row_number,
                    column="задача",
                )
            )

    specs: list[TaskSpec] = []
    for row, public_id in zip(rows, public_ids, strict=True):
        predecessor_ids: list[UUID] = []
        seen_predecessors: set[str] = set()
        row_has_error = False
        for predecessor_name in row.predecessor_names:
            key = predecessor_name.casefold()
            if key in seen_predecessors:
                issues.append(
                    ImportIssue(
                        code="DUPLICATE_PREDECESSOR",
                        message=f"Predecessor '{predecessor_name}' is repeated",
                        row=row.row_number,
                        column="предшественники",
                    )
                )
                row_has_error = True
                continue
            seen_predecessors.add(key)
            if key == row.name.casefold():
                issues.append(
                    ImportIssue(
                        code="SELF_REFERENCE",
                        message=f"Task '{row.name}' cannot depend on itself",
                        row=row.row_number,
                        column="предшественники",
                    )
                )
                row_has_error = True
                continue
            if key in row_ids:
                predecessor_ids.append(row_ids[key])
            elif key in existing_by_name:
                predecessor_ids.append(existing_by_name[key].internal_id)
            else:
                issues.append(
                    ImportIssue(
                        code="UNKNOWN_PREDECESSOR",
                        message=f"Unknown predecessor '{predecessor_name}'",
                        row=row.row_number,
                        column="предшественники",
                    )
                )
                row_has_error = True

        if row_has_error:
            continue
        specs.append(
            TaskSpec(
                internal_id=row_ids[row.name.casefold()],
                public_id=public_id,
                name=row.name,
                description=row.description,
                assignee=row.assignee,
                duration_workdays=row.duration_workdays,
                predecessor_ids=tuple(predecessor_ids),
                created_source=CreatedSource.EXCEL,
            )
        )

    if issues:
        return (), tuple(issues)

    graph_tasks = (
        (*current_plan.tasks, *(_placeholder_task(spec) for spec in specs))
        if mode is ImportMode.APPEND
        else tuple(_placeholder_task(spec) for spec in specs)
    )
    try:
        topological_order(graph_tasks)
    except DependencyCycleError as error:
        indexed = {task.internal_id: task for task in graph_tasks}
        path = " -> ".join(
            indexed[task_id].public_id
            for task_id in error.cycle_path
            if task_id in indexed
        )
        issues.append(
            ImportIssue(
                code="DEPENDENCY_CYCLE",
                message=f"Dependency cycle detected: {path}",
                column="предшественники",
            )
        )
    return tuple(specs), tuple(issues)


def prepare_import(
    *,
    file_name: str,
    content: bytes,
    mode: ImportMode,
    date_constraint: date,
    current_plan: PlanState,
) -> ImportPreparation:
    parsed = parse_xlsx(file_name, content)
    if parsed.issues:
        return ImportPreparation(current_plan, None, parsed.issues)

    try:
        validate_plan_schedule(current_plan)
    except DomainValidationError as error:
        return ImportPreparation(
            current_plan,
            None,
            (
                ImportIssue(
                    code="INVALID_CURRENT_PLAN",
                    message=str(error),
                ),
            ),
        )

    specs, issues = _resolve_specs(parsed.rows, mode, current_plan)
    if issues:
        return ImportPreparation(current_plan, None, issues)

    change = (
        ReplacePlanChange(tasks=specs, plan_start_date=date_constraint)
        if mode is ImportMode.REPLACE
        else AppendPlanChange(tasks=specs, minimum_start_date=date_constraint)
    )
    changeset = prepare_changeset(current_plan, (change,))
    if changeset.status is ChangeSetStatus.INVALID:
        return ImportPreparation(
            current_plan,
            None,
            tuple(
                ImportIssue(code=conflict.code, message=conflict.message)
                for conflict in changeset.conflicts
            ),
        )
    return ImportPreparation(current_plan, changeset, ())
