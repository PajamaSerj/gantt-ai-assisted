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
    assert [str(task.internal_id) for task in plan.tasks] == [
        f"00000000-0000-4000-8000-{number:012d}"
        for number in range(1, 8)
    ]
    assert [task.name for task in plan.tasks] == [
        "Исследование продукта",
        "UX-дизайн",
        "Основа бэкенда",
        "Основа фронтенда",
        "Интеграция приложения",
        "Сквозное тестирование",
        "Подготовка демо",
    ]
    assert [task.description for task in plan.tasks] == [
        "Уточнить сценарий демонстрации и критерии приёмки.",
        "Подготовить основной пользовательский сценарий планирования.",
        "Реализовать базовую архитектуру API планировщика.",
        "Собрать базовый интерфейс веб-приложения.",
        "Связать frontend и backend в единый пользовательский сценарий.",
        "Проверить полный пользовательский сценарий приложения.",
        "Подготовить финальную демонстрацию решения.",
    ]
    assert [task.assignee for task in plan.tasks] == [
        "Анна",
        "Мария",
        "Сергей",
        "Елена",
        "Сергей",
        "Олег",
        "Анна",
    ]
    assert [task.duration_workdays for task in plan.tasks] == [3, 4, 5, 5, 3, 4, 2]
    assert [(task.start_date, task.end_date) for task in plan.tasks] == [
        (date(2026, 2, 2), date(2026, 2, 4)),
        (date(2026, 2, 5), date(2026, 2, 10)),
        (date(2026, 2, 5), date(2026, 2, 11)),
        (date(2026, 2, 11), date(2026, 2, 17)),
        (date(2026, 2, 18), date(2026, 2, 20)),
        (date(2026, 2, 23), date(2026, 2, 26)),
        (date(2026, 2, 27), date(2026, 3, 2)),
    ]
    public_id_by_internal_id = {
        task.internal_id: task.public_id for task in plan.tasks
    }
    assert [
        [public_id_by_internal_id[internal_id] for internal_id in task.predecessor_ids]
        for task in plan.tasks
    ] == [
        [],
        ["TASK-001"],
        ["TASK-001"],
        ["TASK-002"],
        ["TASK-003", "TASK-004"],
        ["TASK-005"],
        ["TASK-006"],
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
