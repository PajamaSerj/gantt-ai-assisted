from datetime import date

import pytest

from app.domain.errors import DuplicateTaskNameError
from app.domain.models import PlanState
from app.domain.scheduling import schedule_finish_to_start


def test_fs_schedule_handles_parallel_tasks_and_multiple_predecessors(
    task_factory,
) -> None:
    tasks = (
        task_factory(1, name="Discovery", duration=3),
        task_factory(2, name="Backend", duration=3, predecessors=(1,)),
        task_factory(3, name="Frontend", duration=5, predecessors=(1,)),
        task_factory(4, name="Integration", duration=2, predecessors=(2, 3)),
    )

    scheduled = schedule_finish_to_start(
        PlanState(tasks=tasks), date(2026, 8, 17)
    )
    by_id = {task.public_id: task for task in scheduled.tasks}

    assert (by_id["TASK-001"].start_date, by_id["TASK-001"].end_date) == (
        date(2026, 8, 17),
        date(2026, 8, 19),
    )
    assert (by_id["TASK-002"].start_date, by_id["TASK-002"].end_date) == (
        date(2026, 8, 20),
        date(2026, 8, 24),
    )
    assert (by_id["TASK-003"].start_date, by_id["TASK-003"].end_date) == (
        date(2026, 8, 20),
        date(2026, 8, 26),
    )
    assert (by_id["TASK-004"].start_date, by_id["TASK-004"].end_date) == (
        date(2026, 8, 27),
        date(2026, 8, 28),
    )


def test_minimum_weekend_start_is_normalized(task_factory) -> None:
    task = task_factory(1, duration=2)

    scheduled = schedule_finish_to_start(
        PlanState(tasks=(task,)), date(2026, 8, 22)
    )

    assert scheduled.tasks[0].start_date == date(2026, 8, 24)
    assert scheduled.tasks[0].end_date == date(2026, 8, 25)


def test_schedule_returns_new_state_without_mutating_input(task_factory) -> None:
    task = task_factory(1)
    original = PlanState(tasks=(task,))

    scheduled = schedule_finish_to_start(original, date(2026, 8, 17))

    assert scheduled is not original
    assert original.tasks[0].start_date == date(2000, 1, 3)


def test_duplicate_names_are_rejected_case_insensitively(task_factory) -> None:
    plan = PlanState(
        tasks=(
            task_factory(1, name="Backend"),
            task_factory(2, name="backend"),
        )
    )

    with pytest.raises(DuplicateTaskNameError):
        schedule_finish_to_start(plan, date(2026, 8, 17))
