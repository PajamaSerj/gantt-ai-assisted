from datetime import date
from uuid import UUID

from app.domain.calendar import (
    end_date_for_duration,
    next_working_day,
    normalize_to_working_day,
)
from app.domain.errors import DuplicateTaskNameError
from app.domain.graph import task_index, topological_order
from app.domain.models import PlanState, Task


def validate_unique_names(tasks: tuple[Task, ...]) -> None:
    counts: dict[str, int] = {}
    display_names: dict[str, str] = {}
    for task in tasks:
        key = task.name.casefold()
        counts[key] = counts.get(key, 0) + 1
        display_names.setdefault(key, task.name)
    duplicates = sorted(
        display_names[key] for key, count in counts.items() if count > 1
    )
    if duplicates:
        raise DuplicateTaskNameError(duplicates)


def schedule_finish_to_start(
    plan: PlanState, minimum_start_date: date
) -> PlanState:
    """Build a deterministic FS schedule for the complete PlanState.

    Root tasks start on the normalized minimum date. Dependent tasks start on
    the later of that date and the next working day after their latest
    predecessor. The function returns a new immutable PlanState.
    """
    validate_unique_names(plan.tasks)
    indexed = task_index(plan.tasks)
    order = topological_order(plan.tasks)
    minimum = normalize_to_working_day(minimum_start_date)
    scheduled: dict[UUID, Task] = {}

    for task_id in order:
        task = indexed[task_id]
        start_date = minimum
        if task.predecessor_ids:
            latest_end = max(
                scheduled[predecessor_id].end_date
                for predecessor_id in task.predecessor_ids
            )
            start_date = max(minimum, next_working_day(latest_end))
        scheduled[task_id] = task.model_copy(
            update={
                "start_date": start_date,
                "end_date": end_date_for_duration(
                    start_date, task.duration_workdays
                ),
            }
        )

    return PlanState(tasks=tuple(scheduled[task.internal_id] for task in plan.tasks))
