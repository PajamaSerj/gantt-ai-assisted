import asyncio
from datetime import date

from app.domain.models import PlanState
from app.domain.scheduling import schedule_finish_to_start
from app.mcp.client import MODEL_TOOL_NAMES, PlanningMCPClient
from app.mcp.context import PlanningRequestContext, bind_planning_context
from app.seed.data import get_seed_plan


async def call_in_context(
    context: PlanningRequestContext,
    name: str,
    arguments: dict | None = None,
) -> dict:
    with bind_planning_context(context):
        async with PlanningMCPClient() as client:
            return await client.call_tool(name, arguments)


def test_official_mcp_client_discovers_all_required_tools() -> None:
    async def discover() -> tuple[set[str], bool]:
        context = PlanningRequestContext(get_seed_plan())
        with bind_planning_context(context):
            async with PlanningMCPClient() as client:
                tools = await client.model_tools()
                names = {tool["name"] for tool in tools}
                return names, "apply_changes" in names

    names, apply_is_model_visible = asyncio.run(discover())

    assert names == MODEL_TOOL_NAMES
    assert apply_is_model_visible is False


def test_read_tools_resolve_public_id_and_unique_name() -> None:
    context = PlanningRequestContext(get_seed_plan())

    by_id = asyncio.run(call_in_context(context, "get_task", {"identifier": "TASK-003"}))
    by_name = asyncio.run(
        call_in_context(context, "get_task", {"identifier": "Backend foundation"})
    )
    dependencies = asyncio.run(
        call_in_context(context, "get_dependencies", {"identifier": "TASK-005"})
    )

    assert by_id == by_name
    assert by_id["task"]["name"] == "Backend foundation"
    assert [task["public_id"] for task in dependencies["predecessors"]] == [
        "TASK-003",
        "TASK-004",
    ]


def test_request_scoped_plan_context_is_isolated() -> None:
    first = get_seed_plan()
    second = PlanState(
        tasks=(first.tasks[0].model_copy(update={"name": "Isolated plan"}),)
    )

    async def read(plan: PlanState) -> str:
        context = PlanningRequestContext(plan)
        with bind_planning_context(context):
            await asyncio.sleep(0)
            async with PlanningMCPClient() as client:
                result = await client.call_tool("get_tasks")
                await asyncio.sleep(0)
                return result["tasks"][0]["name"]

    async def read_both() -> list[str]:
        return list(await asyncio.gather(read(first), read(second)))

    names = asyncio.run(read_both())

    assert names == ["Product discovery", "Isolated plan"]


def test_prepare_tool_does_not_mutate_and_apply_is_guarded() -> None:
    source = get_seed_plan()
    context = PlanningRequestContext(source)

    prepared = asyncio.run(
        call_in_context(
            context,
            "update_task",
            {"identifier": "TASK-001", "description": "Updated"},
        )
    )
    forbidden = asyncio.run(call_in_context(context, "apply_changes"))

    assert prepared["status"] == "accepted"
    assert source.tasks[0].description != "Updated"
    assert forbidden["status"] == "forbidden"

    context.apply_authorized = True
    applied = asyncio.run(call_in_context(context, "apply_changes"))

    assert applied["status"] == "applied"
    assert context.applied_plan.tasks[0].description == "Updated"
    assert source.tasks[0].description != "Updated"


def test_multi_tool_batch_is_validated_as_one_final_state(task_factory) -> None:
    source = schedule_finish_to_start(
        PlanState(
            tasks=(
                task_factory(1, name="Alpha"),
                task_factory(2, name="Beta"),
            )
        ),
        date(2026, 8, 17),
    )
    context = PlanningRequestContext(source)

    async def prepare_and_apply() -> dict:
        with bind_planning_context(context):
            async with PlanningMCPClient() as client:
                await client.call_tool(
                    "update_task", {"identifier": "Alpha", "name": "Beta"}
                )
                await client.call_tool(
                    "update_task", {"identifier": "Beta", "name": "Alpha"}
                )
                context.apply_authorized = True
                return await client.call_tool("apply_changes")

    result = asyncio.run(prepare_and_apply())

    assert result["status"] == "applied"
    assert [task.name for task in context.applied_plan.tasks] == ["Beta", "Alpha"]
    assert [task.name for task in source.tasks] == ["Alpha", "Beta"]


def test_create_task_with_predecessor_only_placement_is_auto_applicable() -> None:
    source = get_seed_plan()
    context = PlanningRequestContext(source)

    async def prepare_and_apply() -> dict:
        with bind_planning_context(context):
            async with PlanningMCPClient() as client:
                prepared = await client.call_tool(
                    "create_task",
                    {
                        "name": "Release notes",
                        "duration_workdays": 2,
                        "predecessor_identifiers": ["TASK-007"],
                    },
                )
                assert prepared["status"] == "accepted"
                context.apply_authorized = True
                return await client.call_tool("apply_changes")

    result = asyncio.run(prepare_and_apply())

    created = context.applied_plan.tasks[-1]
    assert result["status"] == "applied"
    assert created.public_id == "TASK-008"
    assert created.start_date == date(2026, 3, 3)
    assert created.predecessor_ids == (source.tasks[-1].internal_id,)


def test_create_explicit_date_before_predecessor_requires_confirmation() -> None:
    context = PlanningRequestContext(get_seed_plan())

    async def prepare() -> dict:
        with bind_planning_context(context):
            async with PlanningMCPClient() as client:
                await client.call_tool(
                    "create_task",
                    {
                        "name": "Release notes",
                        "duration_workdays": 2,
                        "start_date": "2026-02-02",
                        "predecessor_identifiers": ["TASK-007"],
                    },
                )
                context.apply_authorized = True
                return await client.call_tool("apply_changes")

    result = asyncio.run(prepare())

    assert result["status"] == "confirmation_required"
    assert context.applied_plan is None
    assert result["changeset"]["proposed_impacts"][0]["public_id"] == "TASK-008"
