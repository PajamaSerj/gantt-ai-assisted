from datetime import date
from uuid import UUID

from app.domain.calendar import (
    is_working_day,
    next_working_day,
    working_days_inclusive,
)
from app.domain.changesets import (
    ChangeSet,
    MoveTaskChange,
    SetDurationChange,
    prepare_changeset,
)
from app.domain.errors import ScheduleValidationError, UnknownTaskError
from app.domain.graph import task_index
from app.domain.models import PlanState


def prepare_direct_move(
    current_plan: PlanState,
    task_id: UUID,
    intended_start_date: date,
) -> ChangeSet:
    return prepare_changeset(
        current_plan,
        (MoveTaskChange(task_id=task_id, start_date=intended_start_date),),
    )


def dependency_bound_move_message(
    current_plan: PlanState,
    task_id: UUID,
    intended_start_date: date,
) -> str | None:
    """Explain a direct move that cannot cross the current FS boundary."""
    indexed = task_index(current_plan.tasks)
    task = indexed.get(task_id)
    if task is None:
        raise UnknownTaskError(task_id)
    if not task.predecessor_ids or not is_working_day(intended_start_date):
        return None

    predecessor = max(
        (indexed[predecessor_id] for predecessor_id in task.predecessor_ids),
        key=lambda candidate: candidate.end_date,
    )
    if intended_start_date >= next_working_day(predecessor.end_date):
        return None
    return (
        "Задача не может начинаться раньше завершения "
        f"{predecessor.public_id} · {predecessor.name}."
    )


def prepare_direct_resize(
    current_plan: PlanState,
    task_id: UUID,
    intended_end_date: date,
) -> ChangeSet:
    task = task_index(current_plan.tasks).get(task_id)
    if task is None:
        raise UnknownTaskError(task_id)
    try:
        duration_workdays = working_days_inclusive(
            task.start_date,
            intended_end_date,
        )
    except ValueError as error:
        raise ScheduleValidationError(
            "Дата окончания не может быть раньше даты начала задачи.",
            task_id=task_id,
        ) from error
    if duration_workdays < 1:
        raise ScheduleValidationError(
            "Длительность задачи должна составлять хотя бы один рабочий день.",
            task_id=task_id,
        )
    return prepare_changeset(
        current_plan,
        (
            SetDurationChange(
                task_id=task_id,
                duration_workdays=duration_workdays,
            ),
        ),
    )
