from datetime import date
from uuid import UUID

from app.domain.models import CreatedSource, PlanState, Task

SEED_PLAN_START = date(2026, 2, 2)


def _seed_task(
    *,
    internal_id: str,
    public_id: str,
    name: str,
    description: str,
    assignee: str,
    duration_workdays: int,
    predecessor_ids: tuple[str, ...],
    start_date: date,
    end_date: date,
) -> Task:
    return Task(
        internal_id=UUID(internal_id),
        public_id=public_id,
        name=name,
        description=description,
        assignee=assignee,
        duration_workdays=duration_workdays,
        predecessor_ids=tuple(UUID(value) for value in predecessor_ids),
        start_date=start_date,
        end_date=end_date,
        created_source=CreatedSource.SEED,
    )


_DISCOVERY_ID = "00000000-0000-4000-8000-000000000001"
_DESIGN_ID = "00000000-0000-4000-8000-000000000002"
_BACKEND_ID = "00000000-0000-4000-8000-000000000003"
_FRONTEND_ID = "00000000-0000-4000-8000-000000000004"
_INTEGRATION_ID = "00000000-0000-4000-8000-000000000005"
_QA_ID = "00000000-0000-4000-8000-000000000006"
_LAUNCH_ID = "00000000-0000-4000-8000-000000000007"

_SEED_SNAPSHOT = PlanState(
    tasks=(
        _seed_task(
            internal_id=_DISCOVERY_ID,
            public_id="TASK-001",
            name="Product discovery",
            description="Confirm the demo scenario and acceptance criteria.",
            assignee="Anna",
            duration_workdays=3,
            predecessor_ids=(),
            start_date=date(2026, 2, 2),
            end_date=date(2026, 2, 4),
        ),
        _seed_task(
            internal_id=_DESIGN_ID,
            public_id="TASK-002",
            name="UX design",
            description="Prepare the primary planning workflow.",
            assignee="Maria",
            duration_workdays=4,
            predecessor_ids=(_DISCOVERY_ID,),
            start_date=date(2026, 2, 5),
            end_date=date(2026, 2, 10),
        ),
        _seed_task(
            internal_id=_BACKEND_ID,
            public_id="TASK-003",
            name="Backend foundation",
            description="Implement the planning API foundation.",
            assignee="Sergey",
            duration_workdays=5,
            predecessor_ids=(_DISCOVERY_ID,),
            start_date=date(2026, 2, 5),
            end_date=date(2026, 2, 11),
        ),
        _seed_task(
            internal_id=_FRONTEND_ID,
            public_id="TASK-004",
            name="Frontend foundation",
            description="Build the browser application foundation.",
            assignee="Elena",
            duration_workdays=5,
            predecessor_ids=(_DESIGN_ID,),
            start_date=date(2026, 2, 11),
            end_date=date(2026, 2, 17),
        ),
        _seed_task(
            internal_id=_INTEGRATION_ID,
            public_id="TASK-005",
            name="Application integration",
            description="Connect frontend and backend foundations.",
            assignee="Sergey",
            duration_workdays=3,
            predecessor_ids=(_BACKEND_ID, _FRONTEND_ID),
            start_date=date(2026, 2, 18),
            end_date=date(2026, 2, 20),
        ),
        _seed_task(
            internal_id=_QA_ID,
            public_id="TASK-006",
            name="End-to-end QA",
            description="Validate the complete reviewer workflow.",
            assignee="Oleg",
            duration_workdays=4,
            predecessor_ids=(_INTEGRATION_ID,),
            start_date=date(2026, 2, 23),
            end_date=date(2026, 2, 26),
        ),
        _seed_task(
            internal_id=_LAUNCH_ID,
            public_id="TASK-007",
            name="Demo readiness",
            description="Prepare the final demonstration package.",
            assignee="Anna",
            duration_workdays=2,
            predecessor_ids=(_QA_ID,),
            start_date=date(2026, 2, 27),
            end_date=date(2026, 3, 2),
        ),
    )
)


def get_seed_plan() -> PlanState:
    """Return a deep copy so callers can never mutate the seed singleton."""
    return _SEED_SNAPSHOT.model_copy(deep=True)
