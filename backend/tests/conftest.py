from datetime import date
from uuid import UUID

import pytest

from app.domain.models import CreatedSource, Task


@pytest.fixture
def task_factory():
    def make_task(
        number: int,
        *,
        name: str | None = None,
        duration: int = 1,
        predecessors: tuple[int, ...] = (),
    ) -> Task:
        return Task(
            internal_id=UUID(f"00000000-0000-4000-8000-{number:012d}"),
            public_id=f"TASK-{number:03d}",
            name=name or f"Task {number}",
            description=None,
            assignee=None,
            duration_workdays=duration,
            predecessor_ids=tuple(
                UUID(f"00000000-0000-4000-8000-{value:012d}")
                for value in predecessors
            ),
            start_date=date(2000, 1, 3),
            end_date=date(2000, 1, 3),
            created_source=CreatedSource.AI,
        )

    return make_task
