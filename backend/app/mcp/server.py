from datetime import date
from typing import Any
from uuid import uuid4

from mcp.server import MCPServer

from app.domain.calendar import next_working_day, shift_working_days
from app.domain.changesets import (
    AppendPlanChange,
    ChangeSetStatus,
    MoveTaskChange,
    RenameTaskChange,
    SetAssigneeChange,
    SetDescriptionChange,
    SetDurationChange,
    SetPredecessorsChange,
    apply_changeset,
)
from app.domain.graph import successors_by_task, task_index
from app.domain.ids import next_public_id
from app.domain.models import CreatedSource, Task, TaskSpec, normalize_task_name
from app.mcp.context import (
    PlanningRequestContext,
    TaskResolutionError,
    current_planning_context,
)

planning_mcp = MCPServer(
    "ai-gantt-planner",
    instructions=(
        "Read the request-scoped plan and prepare deterministic planning changes. "
        "Tools never persist a plan or bypass ChangeSet validation."
    ),
)


def _task_view(task: Task, indexed: dict) -> dict[str, Any]:
    return {
        "public_id": task.public_id,
        "name": task.name,
        "description": task.description,
        "assignee": task.assignee,
        "duration_workdays": task.duration_workdays,
        "start_date": task.start_date.isoformat(),
        "end_date": task.end_date.isoformat(),
        "predecessors": [
            indexed[predecessor_id].public_id
            for predecessor_id in task.predecessor_ids
        ],
    }


def _accepted(context: PlanningRequestContext, added: int = 1) -> dict[str, Any]:
    return {
        "status": "accepted",
        "added_changes": added,
        "batch_size": len(context.requested_changes),
    }


def _clarification(
    context: PlanningRequestContext, question: str
) -> dict[str, Any]:
    context.require_clarification(question)
    return {"status": "clarification_required", "message": question}


def _resolve_many(context: PlanningRequestContext, identifiers: list[str]) -> list[Task]:
    if not identifiers:
        raise TaskResolutionError("At least one task must be selected")
    tasks = [context.existing_task(identifier) for identifier in identifiers]
    if len({task.internal_id for task in tasks}) != len(tasks):
        raise TaskResolutionError("Task selection contains duplicates")
    return tasks


@planning_mcp.tool()
async def get_tasks(
    assignee: str | None = None,
    text: str | None = None,
) -> dict[str, Any]:
    """List request-scoped tasks, optionally filtered by assignee or text."""
    context = current_planning_context()
    indexed = task_index(context.plan.tasks)
    assignee_key = assignee.strip().casefold() if assignee else None
    text_key = text.strip().casefold() if text else None
    tasks = []
    for task in context.plan.tasks:
        if assignee_key and (task.assignee or "").casefold() != assignee_key:
            continue
        if text_key and text_key not in " ".join(
            (task.public_id, task.name, task.description or "")
        ).casefold():
            continue
        tasks.append(_task_view(task, indexed))
    return {"tasks": tasks}


@planning_mcp.tool()
async def get_task(identifier: str) -> dict[str, Any]:
    """Resolve one task by public TASK-ID or unique task name."""
    context = current_planning_context()
    task = context.existing_task(identifier)
    return {"task": _task_view(task, task_index(context.plan.tasks))}


@planning_mcp.tool()
async def get_dependencies(identifier: str) -> dict[str, Any]:
    """Return predecessor and successor context for one task."""
    context = current_planning_context()
    task = context.existing_task(identifier)
    indexed = task_index(context.plan.tasks)
    successor_ids = successors_by_task(context.plan.tasks)[task.internal_id]
    return {
        "task": {"public_id": task.public_id, "name": task.name},
        "predecessors": [
            {
                "public_id": indexed[task_id].public_id,
                "name": indexed[task_id].name,
                "end_date": indexed[task_id].end_date.isoformat(),
            }
            for task_id in task.predecessor_ids
        ],
        "successors": [
            {
                "public_id": indexed[task_id].public_id,
                "name": indexed[task_id].name,
                "start_date": indexed[task_id].start_date.isoformat(),
            }
            for task_id in successor_ids
        ],
    }


@planning_mcp.tool()
async def create_task(
    name: str | None = None,
    duration_workdays: int | None = None,
    start_date: date | None = None,
    predecessor_identifiers: list[str] | None = None,
    description: str | None = None,
    assignee: str | None = None,
) -> dict[str, Any]:
    """Prepare a task creation with explicit date and/or predecessor placement."""
    context = current_planning_context()
    if not name:
        return _clarification(context, "Как назвать задачу?")
    try:
        normalized_name = normalize_task_name(name)
    except ValueError as error:
        return _clarification(context, str(error))
    if duration_workdays is None or duration_workdays < 1:
        return _clarification(context, "Укажите положительную длительность задачи.")

    predecessor_identifiers = predecessor_identifiers or []
    if start_date is None and not predecessor_identifiers:
        return _clarification(
            context,
            "С какой даты начать задачу или после какой задачи её поставить?",
        )

    existing_names = {
        task.name.casefold() for task in context.projected_plan().tasks
    }
    existing_names.update(spec.name.casefold() for spec in context.created_specs())
    if normalized_name.casefold() in existing_names:
        return _clarification(
            context,
            f"Задача с названием '{normalized_name}' уже существует. Укажите другое название.",
        )

    try:
        predecessors = [
            context.resolve(identifier)
            for identifier in predecessor_identifiers
        ]
    except TaskResolutionError as error:
        return _clarification(context, str(error))
    if len({task.internal_id for task in predecessors}) != len(predecessors):
        return _clarification(context, "Список predecessors содержит дубликаты.")

    if start_date is None:
        projected_index = task_index(context.projected_plan().tasks)
        predecessor_tasks = [
            projected_index.get(predecessor.internal_id)
            for predecessor in predecessors
        ]
        if any(task is None for task in predecessor_tasks):
            return _clarification(
                context,
                "Сначала завершите placement ранее создаваемой predecessor-задачи.",
            )
        latest_end = max(task.end_date for task in predecessor_tasks if task)
        minimum_start = next_working_day(latest_end)
    else:
        minimum_start = start_date

    existing_ids = [task.public_id for task in context.plan.tasks]
    existing_ids.extend(spec.public_id for spec in context.created_specs())
    internal_id = uuid4()
    spec = TaskSpec(
        internal_id=internal_id,
        public_id=next_public_id(existing_ids),
        name=normalized_name,
        description=description,
        assignee=None,
        duration_workdays=duration_workdays,
        predecessor_ids=tuple(task.internal_id for task in predecessors),
        created_source=CreatedSource.AI,
    )
    context.add_change(
        AppendPlanChange(tasks=(spec,), minimum_start_date=minimum_start)
    )
    added = 1
    if assignee is not None:
        context.add_change(
            SetAssigneeChange(task_id=internal_id, assignee=assignee)
        )
        added += 1
    return _accepted(context, added)


@planning_mcp.tool()
async def update_task(
    identifier: str,
    name: str | None = None,
    description: str | None = None,
    clear_description: bool = False,
    duration_workdays: int | None = None,
) -> dict[str, Any]:
    """Prepare updates to name, description, or duration only."""
    context = current_planning_context()
    try:
        task = context.existing_task(identifier)
    except TaskResolutionError as error:
        return _clarification(context, str(error))

    changes = []
    if name is not None:
        try:
            changes.append(
                RenameTaskChange(
                    task_id=task.internal_id,
                    name=normalize_task_name(name),
                )
            )
        except ValueError as error:
            return _clarification(context, str(error))
    if description is not None or clear_description:
        changes.append(
            SetDescriptionChange(
                task_id=task.internal_id,
                description=None if clear_description else description,
            )
        )
    if duration_workdays is not None:
        if duration_workdays < 1:
            return _clarification(context, "Duration must be a positive integer")
        changes.append(
            SetDurationChange(
                task_id=task.internal_id,
                duration_workdays=duration_workdays,
            )
        )
    if not changes:
        return _clarification(context, "Укажите поле задачи, которое нужно изменить.")
    for change in changes:
        context.add_change(change)
    return _accepted(context, len(changes))


@planning_mcp.tool()
async def move_tasks(
    identifiers: list[str],
    start_date: date | None = None,
    shift_workdays: int | None = None,
    after_task_identifier: str | None = None,
) -> dict[str, Any]:
    """Prepare explicit, signed-working-day, or unambiguous relative task moves."""
    context = current_planning_context()
    modes = sum(
        value is not None
        for value in (start_date, shift_workdays, after_task_identifier)
    )
    if modes != 1:
        return _clarification(
            context,
            "Укажите ровно один способ переноса: дату, сдвиг в рабочих днях или reference task.",
        )
    try:
        tasks = _resolve_many(context, identifiers)
    except TaskResolutionError as error:
        return _clarification(context, str(error))

    reference_start: date | None = None
    if after_task_identifier is not None:
        try:
            reference = context.existing_task(after_task_identifier)
        except TaskResolutionError as error:
            return _clarification(context, str(error))
        reference_start = next_working_day(reference.end_date)

    projected = task_index(context.projected_plan().tasks)
    for task in tasks:
        if start_date is not None:
            proposed_start = start_date
        elif shift_workdays is not None:
            proposed_start = shift_working_days(
                projected[task.internal_id].start_date,
                shift_workdays,
            )
        else:
            assert reference_start is not None
            proposed_start = reference_start
        context.add_change(
            MoveTaskChange(task_id=task.internal_id, start_date=proposed_start)
        )
    return _accepted(context, len(tasks))


@planning_mcp.tool()
async def set_assignee(
    identifiers: list[str], assignee: str | None
) -> dict[str, Any]:
    """Prepare assignment, reassignment, mass reassignment, or removal."""
    context = current_planning_context()
    try:
        tasks = _resolve_many(context, identifiers)
    except TaskResolutionError as error:
        return _clarification(context, str(error))
    for task in tasks:
        context.add_change(
            SetAssigneeChange(task_id=task.internal_id, assignee=assignee)
        )
    return _accepted(context, len(tasks))


def _dependency_context(identifier: str) -> tuple[PlanningRequestContext, Task]:
    context = current_planning_context()
    return context, context.existing_task(identifier)


@planning_mcp.tool()
async def add_predecessor(
    task_identifier: str, predecessor_identifier: str
) -> dict[str, Any]:
    """Prepare adding one Finish-to-Start predecessor."""
    context, task = _dependency_context(task_identifier)
    try:
        predecessor = context.resolve(predecessor_identifier)
    except TaskResolutionError as error:
        return _clarification(context, str(error))
    predecessor_ids = context.predecessor_ids(task.internal_id)
    if predecessor.internal_id in predecessor_ids:
        return _clarification(context, "Эта dependency уже существует.")
    context.add_change(
        SetPredecessorsChange(
            task_id=task.internal_id,
            predecessor_ids=(*predecessor_ids, predecessor.internal_id),
        )
    )
    return _accepted(context)


@planning_mcp.tool()
async def remove_predecessor(
    task_identifier: str, predecessor_identifier: str
) -> dict[str, Any]:
    """Prepare removing one Finish-to-Start predecessor."""
    context, task = _dependency_context(task_identifier)
    try:
        predecessor = context.resolve(predecessor_identifier)
    except TaskResolutionError as error:
        return _clarification(context, str(error))
    predecessor_ids = context.predecessor_ids(task.internal_id)
    if predecessor.internal_id not in predecessor_ids:
        return _clarification(context, "Указанная dependency не существует.")
    context.add_change(
        SetPredecessorsChange(
            task_id=task.internal_id,
            predecessor_ids=tuple(
                task_id
                for task_id in predecessor_ids
                if task_id != predecessor.internal_id
            ),
        )
    )
    return _accepted(context)


@planning_mcp.tool()
async def replace_predecessor(
    task_identifier: str,
    old_predecessor_identifier: str,
    new_predecessor_identifier: str,
) -> dict[str, Any]:
    """Prepare replacing one Finish-to-Start predecessor."""
    context, task = _dependency_context(task_identifier)
    try:
        old_predecessor = context.resolve(old_predecessor_identifier)
        new_predecessor = context.resolve(new_predecessor_identifier)
    except TaskResolutionError as error:
        return _clarification(context, str(error))
    predecessor_ids = list(context.predecessor_ids(task.internal_id))
    if old_predecessor.internal_id not in predecessor_ids:
        return _clarification(context, "Заменяемая dependency не существует.")
    if (
        new_predecessor.internal_id in predecessor_ids
        and new_predecessor.internal_id != old_predecessor.internal_id
    ):
        return _clarification(context, "Новая dependency уже существует.")
    position = predecessor_ids.index(old_predecessor.internal_id)
    predecessor_ids[position] = new_predecessor.internal_id
    context.add_change(
        SetPredecessorsChange(
            task_id=task.internal_id,
            predecessor_ids=tuple(predecessor_ids),
        )
    )
    return _accepted(context)


@planning_mcp.tool()
async def apply_changes() -> dict[str, Any]:
    """Apply only an orchestrator-authorized AUTO_APPLICABLE ChangeSet."""
    context = current_planning_context()
    if not context.requested_changes:
        return {"status": "invalid", "message": "No changes were prepared"}
    changeset = context.prepare()
    if changeset.status is ChangeSetStatus.INVALID:
        return {
            "status": "invalid",
            "changeset": changeset.model_dump(mode="json"),
        }
    if changeset.status is ChangeSetStatus.CONFIRMATION_REQUIRED:
        return {
            "status": "confirmation_required",
            "changeset": changeset.model_dump(mode="json"),
        }
    if not context.apply_authorized:
        return {
            "status": "forbidden",
            "message": "Only the backend orchestrator may authorize apply_changes",
        }
    context.applied_plan = apply_changeset(
        context.plan, changeset, confirmed=False
    )
    return {
        "status": "applied",
        "plan": context.applied_plan.model_dump(mode="json"),
    }
