import asyncio
import json
from copy import deepcopy

import httpx

from app.ai.models import ChatRequest
from app.ai.provider import AIProviderError, ProviderToolCall, ProviderTurn
from app.main import app
from app.seed.data import get_seed_plan
from app.services.chat import CAPABILITY_MESSAGE, orchestrate_chat


class ScriptedProvider:
    def __init__(self, *turns: ProviderTurn) -> None:
        self.turns = list(turns)
        self.requests: list[dict] = []

    async def complete(self, *, input_items, tools) -> ProviderTurn:
        self.requests.append(
            {"input_items": deepcopy(list(input_items)), "tools": deepcopy(list(tools))}
        )
        if not self.turns:
            raise AssertionError("No scripted provider turn remains")
        return self.turns.pop(0)


class FailingProvider:
    async def complete(self, *, input_items, tools) -> ProviderTurn:
        raise AIProviderError("provider unavailable")


def tool_turn(call_id: str, name: str, arguments: dict) -> ProviderTurn:
    return ProviderTurn(
        output_items=(
            {
                "type": "function_call",
                "call_id": call_id,
                "name": name,
                "arguments": json.dumps(arguments),
            },
        ),
        tool_calls=(
            ProviderToolCall(call_id=call_id, name=name, arguments=arguments),
        ),
    )


def final_turn(message: str = "Готово.") -> ProviderTurn:
    return ProviderTurn(output_text=message)


def run_chat(provider, message: str, *, plan=None, conversation_context=()):
    request = ChatRequest(
        message=message,
        plan=plan or get_seed_plan(),
        conversation_context=conversation_context,
    )
    return asyncio.run(orchestrate_chat(request, provider))


def test_safe_edit_reads_through_mcp_and_applies() -> None:
    source = get_seed_plan()
    provider = ScriptedProvider(
        tool_turn("read", "get_task", {"identifier": "TASK-001"}),
        tool_turn(
            "update",
            "update_task",
            {"identifier": "TASK-001", "description": "Updated by AI"},
        ),
        final_turn(),
    )

    response = run_chat(provider, "Обнови описание TASK-001", plan=source)

    assert response.status == "applied"
    assert response.plan.tasks[0].description == "Updated by AI"
    assert source.tasks[0].description != "Updated by AI"
    initial_provider_input = json.dumps(
        provider.requests[0]["input_items"], ensure_ascii=False
    )
    assert "Product discovery" not in initial_provider_input
    assert all(
        tool["name"] != "apply_changes"
        for tool in provider.requests[0]["tools"]
    )


def test_equivalent_help_queries_are_canonical_and_skip_provider() -> None:
    source = get_seed_plan()

    first = run_chat(ScriptedProvider(), "Что ты умеешь?", plan=source)
    second = run_chat(ScriptedProvider(), "  помощь!!! ", plan=source)

    assert first.status == second.status == "clarification_required"
    assert first.message == second.message == CAPABILITY_MESSAGE
    assert first.plan == second.plan == source


def test_routine_success_message_comes_from_deterministic_result() -> None:
    source = get_seed_plan()

    def response(provider_message: str):
        return run_chat(
            ScriptedProvider(
                tool_turn(
                    "update",
                    "update_task",
                    {"identifier": "TASK-001", "description": "Updated"},
                ),
                final_turn(provider_message),
            ),
            "Обнови описание TASK-001",
            plan=source,
        )

    first = response("Готово, вот очень длинное объяснение от модели.")
    second = response("Совсем другая формулировка.")

    assert first.status == second.status == "applied"
    assert first.message == second.message
    assert first.message.startswith("Изменения применены:")


def test_mass_move_is_one_auto_applicable_batch() -> None:
    source = get_seed_plan()
    selected = ["TASK-003", "TASK-005", "TASK-006", "TASK-007"]
    provider = ScriptedProvider(
        tool_turn(
            "move",
            "move_tasks",
            {"identifiers": selected, "shift_workdays": 2},
        ),
        final_turn(),
    )

    response = run_chat(provider, "Сдвинь цепочку на два рабочих дня", plan=source)

    assert response.status == "applied"
    indexed = {task.public_id: task for task in response.plan.tasks}
    assert indexed["TASK-003"].start_date.isoformat() == "2026-02-09"
    assert indexed["TASK-007"].start_date.isoformat() == "2026-03-03"
    assert source.tasks[2].start_date.isoformat() == "2026-02-05"


def test_sergey_week_move_prepares_expected_four_task_preview() -> None:
    source = get_seed_plan()
    provider = ScriptedProvider(
        tool_turn(
            "move-sergey",
            "move_tasks",
            {"identifiers": ["TASK-003", "TASK-005"], "shift_workdays": 5},
        ),
        final_turn(),
    )

    response = run_chat(
        provider,
        "Сдвинь задачи Сергея на неделю вперёд",
        plan=source,
    )

    assert response.status == "confirmation_required"
    assert response.plan == source
    assert response.pending_changeset is not None
    proposed = {
        task.public_id: task.start_date.isoformat()
        for task in response.pending_changeset.proposed_plan.tasks
    }
    assert {task_id: proposed[task_id] for task_id in (
        "TASK-003", "TASK-005", "TASK-006", "TASK-007"
    )} == {
        "TASK-003": "2026-02-12",
        "TASK-005": "2026-02-25",
        "TASK-006": "2026-03-02",
        "TASK-007": "2026-03-06",
    }
    assert [
        impact.public_id
        for impact in response.pending_changeset.proposed_impacts
    ] == ["TASK-006", "TASK-007"]
    assert "must start after" not in response.message
    assert "поскольку зависит от" in response.message


def test_move_success_message_uses_deterministic_workday_and_dates() -> None:
    source = get_seed_plan()

    def response(provider_message: str):
        return run_chat(
            ScriptedProvider(
                tool_turn(
                    "move",
                    "move_tasks",
                    {"identifiers": ["TASK-007"], "shift_workdays": 1},
                ),
                final_turn(provider_message),
            ),
            "Сдвинь задачу 7 на день вперёд",
            plan=source,
        )

    first = response("Провайдер придумал один ответ.")
    second = response("Провайдер придумал другой ответ.")

    assert first.status == second.status == "applied"
    assert first.message == second.message
    assert first.message == (
        "Задача 7 перенесена на 1 рабочий день вперёд. "
        "Новые даты: 2–3 марта."
    )


def test_generic_move_does_not_inherit_last_completed_task_target() -> None:
    first = run_chat(
        ScriptedProvider(
            tool_turn(
                "move-1",
                "move_tasks",
                {"identifiers": ["TASK-007"], "shift_workdays": 1},
            ),
            final_turn(),
        ),
        "Сдвинь задачу 7 на день вперёд",
    )
    second = run_chat(
        ScriptedProvider(
            tool_turn(
                "move-2",
                "move_tasks",
                {"identifiers": ["TASK-007"], "shift_workdays": 1},
            ),
            final_turn(),
        ),
        "Сдвинь задачу 7 на день вперёд",
        plan=first.plan,
        conversation_context=first.conversation_context,
    )
    generic_provider = ScriptedProvider()

    third = run_chat(
        generic_provider,
        "Сдвинь задачу на день вперёд",
        plan=second.plan,
        conversation_context=second.conversation_context,
    )

    assert third.status == "clarification_required"
    assert third.plan == second.plan
    assert "TASK-ID или название задачи" in third.message
    assert generic_provider.requests == []


def test_explicit_anaphoric_move_may_reuse_unambiguous_prior_target() -> None:
    first = run_chat(
        ScriptedProvider(
            tool_turn(
                "move-first",
                "move_tasks",
                {"identifiers": ["TASK-007"], "shift_workdays": 1},
            ),
            final_turn(),
        ),
        "Сдвинь задачу 7 на день вперёд",
    )
    provider = ScriptedProvider(
        tool_turn(
            "move-again",
            "move_tasks",
            {"identifiers": ["TASK-007"], "shift_workdays": 1},
        ),
        final_turn(),
    )

    response = run_chat(
        provider,
        "Сдвинь эту же задачу ещё на день",
        plan=first.plan,
        conversation_context=first.conversation_context,
    )

    assert response.status == "applied"
    assert response.plan.tasks[-1].start_date.isoformat() == "2026-03-03"
    assert provider.requests[0]["input_items"][-1]["content"] == (
        "Сдвинь эту же задачу ещё на день"
    )


def test_dependency_shift_returns_consolidated_transitive_confirmation() -> None:
    source = get_seed_plan()
    provider = ScriptedProvider(
        tool_turn(
            "move",
            "move_tasks",
            {"identifiers": ["TASK-003"], "start_date": "2026-02-23"},
        ),
        final_turn("Перенос подготовлен."),
    )

    response = run_chat(provider, "Перенеси Backend foundation", plan=source)

    assert response.status == "confirmation_required"
    assert response.plan == source
    assert response.pending_changeset is not None
    assert [
        impact.public_id for impact in response.pending_changeset.proposed_impacts
    ] == ["TASK-005", "TASK-006", "TASK-007"]
    assert response.available_options == ("apply_all", "cancel")


def test_added_dependency_returns_transitive_confirmation() -> None:
    source = get_seed_plan()
    provider = ScriptedProvider(
        tool_turn(
            "dependency",
            "add_predecessor",
            {
                "task_identifier": "TASK-003",
                "predecessor_identifier": "TASK-004",
            },
        ),
        final_turn("Зависимость подготовлена."),
    )

    response = run_chat(
        provider,
        "Сделай TASK-003 зависимой от TASK-004",
        plan=source,
    )

    assert response.status == "confirmation_required"
    assert response.plan == source
    assert response.pending_changeset is not None
    assert [
        impact.public_id for impact in response.pending_changeset.proposed_impacts
    ] == ["TASK-003", "TASK-005", "TASK-006", "TASK-007"]


def test_weekend_move_requires_confirmation() -> None:
    provider = ScriptedProvider(
        tool_turn(
            "move",
            "move_tasks",
            {"identifiers": ["TASK-001"], "start_date": "2026-08-22"},
        ),
        final_turn(),
    )

    response = run_chat(provider, "Перенеси TASK-001 на 22 августа")

    assert response.status == "confirmation_required"
    normalization = response.pending_changeset.date_normalizations[0]
    assert normalization.requested_date.isoformat() == "2026-08-22"
    assert normalization.normalized_date.isoformat() == "2026-08-24"


def test_unseen_assignee_requires_confirmation() -> None:
    provider = ScriptedProvider(
        tool_turn(
            "assign",
            "set_assignee",
            {"identifiers": ["TASK-001"], "assignee": "Boris"},
        ),
        final_turn(),
    )

    response = run_chat(provider, "Передай TASK-001 Борису")

    assert response.status == "confirmation_required"
    assert response.pending_changeset.confirmation_reasons[0].code == "NEW_ASSIGNEE"
    assert response.plan.tasks[0].assignee == "Anna"


def test_create_without_placement_returns_clarification() -> None:
    provider = ScriptedProvider(
        tool_turn(
            "create",
            "create_task",
            {"name": "Code Review", "duration_workdays": 2},
        ),
        final_turn("С какой даты начать задачу или после какой задачи её поставить?"),
    )

    response = run_chat(provider, "Добавь Code Review на два дня")

    assert response.status == "clarification_required"
    assert response.plan == get_seed_plan()
    assert "С какой даты" in response.message


def test_reserved_task_name_returns_human_readable_clarification() -> None:
    provider = ScriptedProvider(
        tool_turn(
            "create",
            "create_task",
            {
                "name": "Backend; Frontend",
                "duration_workdays": 2,
                "start_date": "2026-08-17",
            },
        ),
        final_turn("Измените название задачи."),
    )

    response = run_chat(provider, "Добавь задачу Backend; Frontend")

    assert response.status == "clarification_required"
    assert response.plan == get_seed_plan()
    assert response.pending_changeset is None
    assert "reserved as the Excel predecessor separator" in response.message


def test_stateless_follow_up_uses_conversation_context() -> None:
    source = get_seed_plan()
    first_provider = ScriptedProvider(
        tool_turn(
            "create",
            "create_task",
            {"name": "Code Review", "duration_workdays": 2},
        ),
        final_turn(),
    )
    first_request = ChatRequest(
        message="Добавь Code Review на два дня",
        plan=source,
    )
    first_response = asyncio.run(orchestrate_chat(first_request, first_provider))
    second_provider = ScriptedProvider(
        tool_turn(
            "create",
            "create_task",
            {
                "name": "Code Review",
                "duration_workdays": 2,
                "start_date": "2026-03-03",
            },
        ),
        final_turn(),
    )
    second_request = ChatRequest(
        message="Начни 3 марта 2026 года",
        plan=source,
        conversation_context=first_response.conversation_context,
    )

    second_response = asyncio.run(
        orchestrate_chat(second_request, second_provider)
    )

    assert second_response.status == "applied"
    assert second_response.plan.tasks[-1].name == "Code Review"
    first_input = second_provider.requests[0]["input_items"]
    assert first_input[-2]["role"] == "assistant"
    assert "С какой даты" in first_input[-2]["content"]
    assert first_input[-1] == {
        "role": "user",
        "content": "Начни 3 марта 2026 года",
    }


def test_provider_error_endpoint_keeps_plan_unchanged() -> None:
    source = get_seed_plan().model_dump(mode="json")

    async def post_chat() -> httpx.Response:
        app.state.ai_provider = FailingProvider()
        try:
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(
                transport=transport, base_url="http://testserver"
            ) as client:
                return await client.post(
                    "/api/chat",
                    json={
                        "message": "Перенеси TASK-001",
                        "plan": source,
                        "conversation_context": [],
                    },
                )
        finally:
            del app.state.ai_provider

    response = asyncio.run(post_chat())

    assert response.status_code == 502
    assert response.json()["status"] == "provider_error"
    assert response.json()["plan"] == source


def test_chat_endpoint_returns_applied_plan() -> None:
    source = get_seed_plan().model_dump(mode="json")
    provider = ScriptedProvider(
        tool_turn(
            "update",
            "update_task",
            {"identifier": "TASK-001", "description": "Updated through API"},
        ),
        final_turn("Описание обновлено."),
    )

    async def post_chat() -> httpx.Response:
        app.state.ai_provider = provider
        try:
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(
                transport=transport, base_url="http://testserver"
            ) as client:
                return await client.post(
                    "/api/chat",
                    json={
                        "message": "Обнови описание TASK-001",
                        "plan": source,
                        "conversation_context": [],
                    },
                )
        finally:
            del app.state.ai_provider

    response = asyncio.run(post_chat())

    assert response.status_code == 200
    assert response.json()["status"] == "applied"
    assert response.json()["plan"]["tasks"][0]["description"] == (
        "Updated through API"
    )
    assert source["tasks"][0]["description"] != "Updated through API"
