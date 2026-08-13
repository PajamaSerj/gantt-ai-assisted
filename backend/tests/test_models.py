from datetime import date
from uuid import UUID

import pytest
from pydantic import ValidationError

from app.domain.models import CreatedSource, PlanState, Task


def valid_task_data() -> dict:
    return {
        "internal_id": UUID("00000000-0000-4000-8000-000000000001"),
        "public_id": "TASK-001",
        "name": "Backend",
        "description": " API foundation ",
        "assignee": " Sergey ",
        "duration_workdays": 2,
        "predecessor_ids": (),
        "start_date": date(2026, 8, 17),
        "end_date": date(2026, 8, 18),
        "created_source": CreatedSource.SEED,
    }


def test_task_normalizes_human_text_and_is_immutable() -> None:
    task = Task(**valid_task_data())

    assert task.description == "API foundation"
    assert task.assignee == "Sergey"
    with pytest.raises(ValidationError):
        task.name = "Changed"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("public_id", "TASK-1"),
        ("public_id", "TASK-000"),
        ("name", "   "),
        ("duration_workdays", 0),
        (
            "predecessor_ids",
            (
                UUID("00000000-0000-4000-8000-000000000002"),
                UUID("00000000-0000-4000-8000-000000000002"),
            ),
        ),
    ],
)
def test_invalid_task_fields_are_rejected(field: str, value) -> None:
    data = valid_task_data()
    data[field] = value
    with pytest.raises(ValidationError):
        Task(**data)


def test_plan_state_has_only_tasks() -> None:
    with pytest.raises(ValidationError):
        PlanState(tasks=(), version=1)
