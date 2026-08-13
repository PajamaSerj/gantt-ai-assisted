from datetime import date

from app.domain.models import CreatedSource
from app.domain.scheduling import schedule_finish_to_start
from app.seed.data import SEED_PLAN_START, get_seed_plan


def test_seed_is_fixed_and_demonstrates_required_shapes() -> None:
    plan = get_seed_plan()

    assert len(plan.tasks) == 7
    assert [task.public_id for task in plan.tasks] == [
        "TASK-001",
        "TASK-002",
        "TASK-003",
        "TASK-004",
        "TASK-005",
        "TASK-006",
        "TASK-007",
    ]
    assert min(task.start_date for task in plan.tasks) == date(2026, 2, 2)
    assert len({task.assignee for task in plan.tasks}) >= 4
    assert any(len(task.predecessor_ids) > 1 for task in plan.tasks)
    assert all(task.created_source is CreatedSource.SEED for task in plan.tasks)


def test_seed_dates_are_a_valid_fs_snapshot() -> None:
    plan = get_seed_plan()
    assert schedule_finish_to_start(plan, SEED_PLAN_START) == plan


def test_seed_accessor_returns_independent_deep_copies() -> None:
    first = get_seed_plan()
    second = get_seed_plan()

    assert first == second
    assert first is not second
    assert first.tasks[0] is not second.tasks[0]
