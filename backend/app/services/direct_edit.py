from datetime import date
from uuid import UUID

from app.domain.calendar import working_days_inclusive
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
