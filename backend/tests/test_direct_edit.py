import asyncio
from datetime import date

import httpx

from app.main import app
from app.seed.data import get_seed_plan


async def post_direct(edit: dict, current_plan=None) -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://testserver",
    ) as client:
        return await client.post(
            "/api/direct-edits/prepare",
            json={
                "current_plan": (current_plan or get_seed_plan()).model_dump(
                    mode="json"
                ),
                "edit": edit,
            },
        )


def task_id(number: int) -> str:
    return f"00000000-0000-4000-8000-{number:012d}"


def test_safe_direct_move_is_prepared_and_applied_without_provider(
    monkeypatch,
) -> None:
    class ExplodingProvider:
        async def complete(self, *_args, **_kwargs):
            raise AssertionError("Direct edits must not call the AI provider")

    monkeypatch.setattr(
        app.state,
        "ai_provider",
        ExplodingProvider(),
        raising=False,
    )

    response = asyncio.run(
        post_direct(
            {
                "type": "move",
                "task_id": task_id(7),
                "intended_start_date": "2026-03-02",
            }
        )
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "APPLIED"
    assert body["changeset"] is None
    moved = body["plan"]["tasks"][6]
    assert moved["start_date"] == "2026-03-02"
    assert moved["end_date"] == "2026-03-03"


def test_direct_move_with_downstream_impacts_returns_pending_changeset() -> None:
    response = asyncio.run(
        post_direct(
            {
                "type": "move",
                "task_id": task_id(5),
                "intended_start_date": "2026-02-23",
            }
        )
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "CONFIRMATION_REQUIRED"
    assert body["plan"] == get_seed_plan().model_dump(mode="json")
    assert body["changeset"]["requested_changes"] == [
        {
            "type": "move_task",
            "task_id": task_id(5),
            "start_date": "2026-02-23",
        }
    ]
    assert [
        impact["public_id"]
        for impact in body["changeset"]["proposed_impacts"]
    ] == ["TASK-006", "TASK-007"]


def test_dependency_bound_noop_move_returns_concise_message_without_pending(
    monkeypatch,
) -> None:
    class ExplodingProvider:
        async def complete(self, *_args, **_kwargs):
            raise AssertionError("Direct edits must not call the AI provider")

    monkeypatch.setattr(
        app.state,
        "ai_provider",
        ExplodingProvider(),
        raising=False,
    )

    response = asyncio.run(
        post_direct(
            {
                "type": "move",
                "task_id": task_id(7),
                "intended_start_date": "2026-02-26",
            }
        )
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "INVALID"
    assert body["plan"] == get_seed_plan().model_dump(mode="json")
    assert body["changeset"] is None
    assert body["message"] == (
        "Задача не может начинаться раньше завершения "
        "TASK-006 · Сквозное тестирование."
    )


def test_direct_move_to_existing_date_is_not_applied_as_a_change() -> None:
    source = get_seed_plan()
    response = asyncio.run(
        post_direct(
            {
                "type": "move",
                "task_id": task_id(4),
                "intended_start_date": "2026-02-11",
            },
            source,
        )
    )

    body = response.json()
    assert body["status"] == "INVALID"
    assert body["plan"] == source.model_dump(mode="json")
    assert body["changeset"] is None
    assert body["message"] == "Задача уже начинается 11 февраля."


def test_direct_resize_to_existing_duration_is_not_applied_as_a_change() -> None:
    source = get_seed_plan()
    response = asyncio.run(
        post_direct(
            {
                "type": "resize",
                "task_id": task_id(7),
                "intended_end_date": "2026-03-02",
            },
            source,
        )
    )

    body = response.json()
    assert body["status"] == "INVALID"
    assert body["plan"] == source.model_dump(mode="json")
    assert body["changeset"] is None
    assert body["message"] == "Длительность задачи уже составляет 2 рабочих дня."


def test_weekend_direct_move_uses_existing_normalization_confirmation() -> None:
    response = asyncio.run(
        post_direct(
            {
                "type": "move",
                "task_id": task_id(7),
                "intended_start_date": "2026-02-28",
            }
        )
    )

    body = response.json()
    assert body["status"] == "CONFIRMATION_REQUIRED"
    assert body["plan"] == get_seed_plan().model_dump(mode="json")
    assert body["changeset"]["date_normalizations"] == [
        {
            "context": "task_move",
            "requested_date": "2026-02-28",
            "normalized_date": "2026-03-02",
            "task_public_id": "TASK-007",
        }
    ]


def test_weekend_normalization_to_existing_date_returns_noop() -> None:
    plan = get_seed_plan()
    tasks = list(plan.tasks)
    tasks[5] = tasks[5].model_copy(
        update={"duration_workdays": 5, "end_date": date(2026, 2, 27)}
    )
    tasks[6] = tasks[6].model_copy(
        update={
            "start_date": date(2026, 3, 2),
            "end_date": date(2026, 3, 3),
        }
    )
    current_plan = plan.model_copy(update={"tasks": tuple(tasks)})

    response = asyncio.run(
        post_direct(
            {
                "type": "move",
                "task_id": task_id(7),
                "intended_start_date": "2026-03-01",
            },
            current_plan,
        )
    )

    body = response.json()
    assert body["status"] == "INVALID"
    assert body["changeset"] is None
    assert body["plan"] == current_plan.model_dump(mode="json")
    assert body["message"] == "Задача уже начинается 2 марта."


def test_safe_right_resize_converts_visual_end_to_working_day_duration(
    monkeypatch,
) -> None:
    class ExplodingProvider:
        async def complete(self, *_args, **_kwargs):
            raise AssertionError("Direct edits must not call the AI provider")

    monkeypatch.setattr(
        app.state,
        "ai_provider",
        ExplodingProvider(),
        raising=False,
    )

    response = asyncio.run(
        post_direct(
            {
                "type": "resize",
                "task_id": task_id(7),
                "intended_end_date": "2026-03-04",
            }
        )
    )

    body = response.json()
    assert body["status"] == "APPLIED"
    resized = body["plan"]["tasks"][6]
    assert resized["duration_workdays"] == 4
    assert resized["start_date"] == "2026-02-27"
    assert resized["end_date"] == "2026-03-04"


def test_right_resize_with_downstream_impacts_returns_pending_changeset() -> None:
    response = asyncio.run(
        post_direct(
            {
                "type": "resize",
                "task_id": task_id(5),
                "intended_end_date": "2026-02-24",
            }
        )
    )

    body = response.json()
    assert body["status"] == "CONFIRMATION_REQUIRED"
    assert body["plan"] == get_seed_plan().model_dump(mode="json")
    assert body["changeset"]["requested_changes"] == [
        {
            "type": "set_duration",
            "task_id": task_id(5),
            "duration_workdays": 5,
        }
    ]
    assert [
        impact["public_id"]
        for impact in body["changeset"]["proposed_impacts"]
    ] == ["TASK-006", "TASK-007"]


def test_right_resize_before_task_start_is_rejected() -> None:
    response = asyncio.run(
        post_direct(
            {
                "type": "resize",
                "task_id": task_id(7),
                "intended_end_date": "2026-02-26",
            }
        )
    )

    assert response.status_code == 422
    assert response.json()["detail"] == (
        "Дата окончания не может быть раньше даты начала задачи."
    )
