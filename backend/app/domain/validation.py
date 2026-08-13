from app.domain.calendar import end_date_for_duration, is_working_day, next_working_day
from app.domain.errors import DuplicatePublicIdError, ScheduleValidationError
from app.domain.graph import task_index, topological_order
from app.domain.models import PlanState
from app.domain.scheduling import validate_unique_names


def validate_plan_structure(plan: PlanState) -> None:
    """Validate identity, name, and dependency-graph invariants."""
    validate_unique_names(plan.tasks)
    task_index(plan.tasks)

    counts: dict[str, int] = {}
    for task in plan.tasks:
        counts[task.public_id] = counts.get(task.public_id, 0) + 1
    duplicates = sorted(public_id for public_id, count in counts.items() if count > 1)
    if duplicates:
        raise DuplicatePublicIdError(duplicates)

    topological_order(plan.tasks)


def validate_plan_schedule(plan: PlanState) -> None:
    """Require explicit dates to match duration and Finish-to-Start rules."""
    validate_plan_structure(plan)
    indexed = task_index(plan.tasks)

    for task in plan.tasks:
        if not is_working_day(task.start_date):
            raise ScheduleValidationError(
                f"{task.public_id} starts on a non-working day", task.internal_id
            )
        expected_end = end_date_for_duration(
            task.start_date, task.duration_workdays
        )
        if task.end_date != expected_end:
            raise ScheduleValidationError(
                f"{task.public_id} end date does not match its duration",
                task.internal_id,
            )
        if task.predecessor_ids:
            latest_end = max(
                indexed[predecessor_id].end_date
                for predecessor_id in task.predecessor_ids
            )
            required_start = next_working_day(latest_end)
            if task.start_date < required_start:
                raise ScheduleValidationError(
                    f"{task.public_id} violates Finish-to-Start constraints",
                    task.internal_id,
                )
