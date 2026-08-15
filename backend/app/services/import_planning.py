from dataclasses import dataclass
from datetime import date
from enum import StrEnum
from uuid import UUID, uuid4

from app.domain.changesets import (
    AppendPlanChange,
    ChangeConflict,
    ChangeSet,
    ChangeSetStatus,
    ReplacePlanChange,
    changeset_has_effect,
    prepare_changeset,
)
from app.domain.errors import (
    DependencyCycleError,
    DomainValidationError,
    DuplicateInternalIdError,
    DuplicatePublicIdError,
    DuplicateTaskNameError,
    ScheduleValidationError,
    SelfReferenceError,
    UnknownPredecessorError,
)
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
        if self.changeset is None:
            return "NO_CHANGE"
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


def _unknown_predecessor_message(mode: ImportMode, name: str) -> str:
    if mode is ImportMode.REPLACE:
        return (
            f"Предшественник «{name}» не найден. В режиме замены он должен "
            "быть отдельной задачей в загружаемом Excel."
        )
    return (
        f"Предшественник «{name}» не найден ни в загружаемом Excel, "
        "ни в текущем плане."
    )


def _public_id_for_task(plan: PlanState, task_id: UUID | None) -> str | None:
    if task_id is None:
        return None
    return next(
        (
            task.public_id
            for task in plan.tasks
            if task.internal_id == task_id
        ),
        None,
    )


def _current_plan_error_message(
    error: DomainValidationError,
    current_plan: PlanState,
) -> str:
    task_public_id = _public_id_for_task(
        current_plan,
        getattr(error, "task_id", None),
    )
    if isinstance(error, DuplicateTaskNameError):
        names = ", ".join(f"«{name}»" for name in error.duplicate_names)
        return f"В текущем плане повторяются названия задач: {names}."
    if isinstance(error, UnknownPredecessorError):
        task_reference = (
            f"задача {task_public_id}"
            if task_public_id
            else "одна из задач"
        )
        return (
            f"В текущем плане {task_reference} ссылается на отсутствующего "
            "предшественника."
        )
    if isinstance(error, SelfReferenceError):
        task_reference = (
            f"Задача {task_public_id}"
            if task_public_id
            else "Задача в текущем плане"
        )
        return f"{task_reference} не может зависеть сама от себя."
    if isinstance(error, DependencyCycleError):
        path = " → ".join(
            filter(
                None,
                (
                    _public_id_for_task(current_plan, task_id)
                    for task_id in error.cycle_path
                ),
            )
        )
        return (
            f"В текущем плане обнаружен цикл зависимостей: {path}."
            if path
            else "В текущем плане обнаружен цикл зависимостей."
        )
    if isinstance(error, DuplicatePublicIdError):
        return (
            "В текущем плане повторяются TASK-ID: "
            f"{', '.join(error.duplicate_ids)}."
        )
    if isinstance(error, DuplicateInternalIdError):
        return "В текущем плане повторяется внутренний идентификатор задачи."
    if isinstance(error, ScheduleValidationError):
        suffix = f" для {task_public_id}" if task_public_id else ""
        return f"Текущий план содержит некорректное расписание{suffix}."
    return "Текущий план не прошёл проверку перед импортом."


def _localized_conflict_message(conflict: ChangeConflict) -> str:
    if conflict.code == "DuplicateTaskNameError":
        return "Изменения импорта нарушают уникальность названий задач."
    if conflict.code == "UnknownPredecessorError":
        return (
            f"Задача {conflict.task_public_id} ссылается на отсутствующего "
            "предшественника."
            if conflict.task_public_id
            else "Одна из задач ссылается на отсутствующего предшественника."
        )
    if conflict.code == "SelfReferenceError":
        return (
            f"Задача {conflict.task_public_id} не может зависеть сама от себя."
            if conflict.task_public_id
            else "Задача не может зависеть сама от себя."
        )
    if conflict.code == "DependencyCycleError":
        path = " → ".join(conflict.related_task_public_ids)
        return (
            f"Обнаружен цикл зависимостей: {path}."
            if path
            else "Обнаружен цикл зависимостей."
        )
    if conflict.code == "DuplicatePublicIdError":
        return "Изменения импорта содержат повторяющиеся TASK-ID."
    if conflict.code == "DuplicateInternalIdError":
        return "Изменения импорта содержат повторяющиеся идентификаторы задач."
    if conflict.code == "ScheduleValidationError":
        return (
            f"Расписание задачи {conflict.task_public_id} нарушает правила "
            "планирования."
            if conflict.task_public_id
            else "Расписание импортируемого плана нарушает правила планирования."
        )
    return "Импорт не прошёл проверку целостности плана."


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
                        f"Задача «{row.name}» уже существует в текущем плане "
                        f"как {existing.public_id}."
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
                        message=(
                            f"Предшественник «{predecessor_name}» указан "
                            "повторно."
                        ),
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
                        message=(
                            f"Задача «{row.name}» не может зависеть сама от себя."
                        ),
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
                        message=_unknown_predecessor_message(
                            mode,
                            predecessor_name,
                        ),
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
        path = " → ".join(
            indexed[task_id].public_id
            for task_id in error.cycle_path
            if task_id in indexed
        )
        issues.append(
            ImportIssue(
                code="DEPENDENCY_CYCLE",
                message=f"Обнаружен цикл зависимостей: {path}.",
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
                    message=_current_plan_error_message(error, current_plan),
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
                ImportIssue(
                    code=conflict.code,
                    message=_localized_conflict_message(conflict),
                )
                for conflict in changeset.conflicts
            ),
        )
    if not changeset_has_effect(changeset, current_plan):
        return ImportPreparation(current_plan, None, ())
    return ImportPreparation(current_plan, changeset, ())
