import re
from datetime import date, timedelta
from typing import Any

from app.ai.models import (
    ChatRequest,
    ChatResponse,
    ChatStatus,
    ConversationMessage,
)
from app.ai.provider import AIProvider, AIProviderError
from app.domain.calendar import is_working_day
from app.domain.changesets import (
    ChangeSet,
    ChangeSetStatus,
    MoveTaskChange,
)
from app.domain.models import PlanState
from app.domain.validation import validate_plan_schedule
from app.mcp.client import PlanningMCPClient
from app.mcp.context import (
    PlanningRequestContext,
    bind_planning_context,
)

MAX_PROVIDER_ROUNDS = 12

CAPABILITY_MESSAGE = (
    "Могу переносить задачи и группы задач, менять исполнителей и зависимости, "
    "добавлять новые задачи и помогать перестраивать план. Если данных не хватает "
    "или изменение затронет другие задачи — сначала уточню или попрошу подтверждение."
)

_HELP_QUERIES = {
    "что ты умеешь",
    "что можешь",
    "помощь",
    "help",
}

_GENERIC_MOVE_PATTERN = re.compile(
    r"^\s*(?:сдвинь|перенеси|перемести|смести|move|shift)\s+"
    r"(?:задачу|task)\s+(?:(?:ещ[её]|еще)\s+)?"
    r"(?:на\b|впер[её]д\b|назад\b|by\b|forward\b|back(?:ward)?\b)",
    re.IGNORECASE,
)
_TARGET_CLARIFICATION = (
    "Уточните TASK-ID или название задачи, которую нужно перенести."
)

_RUSSIAN_MONTHS = (
    "января",
    "февраля",
    "марта",
    "апреля",
    "мая",
    "июня",
    "июля",
    "августа",
    "сентября",
    "октября",
    "ноября",
    "декабря",
)


def _is_help_query(message: str) -> bool:
    normalized = re.sub(r"[^\w\s]", "", message.casefold())
    normalized = " ".join(normalized.split())
    return normalized in _HELP_QUERIES


def _is_clearly_generic_move(message: str) -> bool:
    """Catch the narrow unsafe case without replacing provider intent parsing."""
    return _GENERIC_MOVE_PATTERN.search(message) is not None


def _conversation_with_reply(
    request: ChatRequest, message: str
) -> tuple[ConversationMessage, ...]:
    return (
        *request.conversation_context,
        ConversationMessage(role="user", content=request.message),
        ConversationMessage(role="assistant", content=message),
    )


def _initial_input(request: ChatRequest) -> list[dict[str, Any]]:
    return [
        *[
            {"role": message.role, "content": message.content}
            for message in request.conversation_context
        ],
        {"role": "user", "content": request.message},
    ]


def _conflict_message(changeset: ChangeSet) -> str:
    if changeset.conflicts:
        return " ".join(conflict.message for conflict in changeset.conflicts)
    return "Предложенные изменения нельзя применить к текущему плану."


def _confirmation_message(changeset: ChangeSet) -> str:
    details = [reason.message for reason in changeset.confirmation_reasons]
    details.extend(
        f"{impact.public_id} будет перенесена с "
        f"{impact.current_start_date.isoformat()} на "
        f"{impact.proposed_start_date.isoformat()}: {impact.reason}."
        for impact in changeset.proposed_impacts
    )
    details.extend(
        f"Дата {normalization.requested_date.isoformat()} нормализуется на "
        f"{normalization.normalized_date.isoformat()}."
        for normalization in changeset.date_normalizations
    )
    prefix = "Изменения подготовлены."
    if not details:
        return prefix
    return f"{prefix} Требуется подтверждение: {' '.join(details)}"


def _compact_task_reference(public_id: str) -> str:
    match = re.fullmatch(r"TASK-(\d+)", public_id, re.IGNORECASE)
    if not match:
        return public_id
    return str(int(match.group(1)))


def _working_day_delta(start_date: date, end_date: date) -> int:
    if start_date == end_date:
        return 0
    direction = 1 if end_date > start_date else -1
    cursor = start_date
    delta = 0
    while cursor != end_date:
        cursor += timedelta(days=direction)
        if is_working_day(cursor):
            delta += direction
    return delta


def _working_day_phrase(value: int) -> str:
    absolute = abs(value)
    modulo_100 = absolute % 100
    modulo_10 = absolute % 10
    if modulo_10 == 1 and modulo_100 != 11:
        noun = "рабочий день"
    elif modulo_10 in {2, 3, 4} and modulo_100 not in {12, 13, 14}:
        noun = "рабочих дня"
    else:
        noun = "рабочих дней"
    return f"{absolute} {noun}"


def _format_date_range(start_date: date, end_date: date) -> str:
    if start_date == end_date:
        result = f"{start_date.day} {_RUSSIAN_MONTHS[start_date.month - 1]}"
    elif (
        start_date.month == end_date.month
        and start_date.year == end_date.year
    ):
        result = (
            f"{start_date.day}–{end_date.day} "
            f"{_RUSSIAN_MONTHS[start_date.month - 1]}"
        )
    else:
        result = (
            f"{start_date.day} {_RUSSIAN_MONTHS[start_date.month - 1]} – "
            f"{end_date.day} {_RUSSIAN_MONTHS[end_date.month - 1]}"
        )
    if start_date.year != end_date.year:
        result = (
            f"{start_date.day} {_RUSSIAN_MONTHS[start_date.month - 1]} "
            f"{start_date.year} – {end_date.day} "
            f"{_RUSSIAN_MONTHS[end_date.month - 1]} {end_date.year}"
        )
    return result


def _move_applied_message(
    changeset: ChangeSet,
    source_plan: PlanState,
    applied_plan: PlanState,
) -> str | None:
    moves = [
        change
        for change in changeset.requested_changes
        if isinstance(change, MoveTaskChange)
    ]
    if not moves or len(moves) != len(changeset.requested_changes):
        return None
    source_by_id = {task.internal_id: task for task in source_plan.tasks}
    applied_by_id = {task.internal_id: task for task in applied_plan.tasks}
    pairs = [
        (source_by_id.get(move.task_id), applied_by_id.get(move.task_id))
        for move in moves
    ]
    if any(before is None or after is None for before, after in pairs):
        return None

    resolved_pairs = [
        (before, after)
        for before, after in pairs
        if before is not None and after is not None
    ]
    deltas = {
        _working_day_delta(before.start_date, after.start_date)
        for before, after in resolved_pairs
    }
    if len(resolved_pairs) == 1:
        before, after = resolved_pairs[0]
        delta = next(iter(deltas))
        movement = ""
        if delta:
            direction = "вперёд" if delta > 0 else "назад"
            movement = f" на {_working_day_phrase(delta)} {direction}"
        return (
            f"Задача {_compact_task_reference(after.public_id)} перенесена"
            f"{movement}. Новые даты: "
            f"{_format_date_range(after.start_date, after.end_date)}."
        )

    if len(deltas) == 1:
        delta = next(iter(deltas))
        if delta:
            direction = "вперёд" if delta > 0 else "назад"
            return (
                f"Перенесено задач: {len(resolved_pairs)} — "
                f"на {_working_day_phrase(delta)} {direction}."
            )
    return f"Перенесено задач: {len(resolved_pairs)}. Новые даты рассчитаны."


def _applied_message(
    changeset: ChangeSet,
    source_plan: PlanState,
    applied_plan: PlanState,
) -> str:
    move_message = _move_applied_message(changeset, source_plan, applied_plan)
    if move_message is not None:
        return move_message
    affected = changeset.affected_tasks
    if len(affected) == 1:
        task = affected[0]
        return f"Изменения применены: {task.public_id} · {task.name}."
    if affected:
        return f"Изменения применены: {len(affected)} задач."
    return "Изменения применены."


def provider_error_response(
    request: ChatRequest, message: str
) -> ChatResponse:
    return ChatResponse(
        status=ChatStatus.PROVIDER_ERROR,
        message=message,
        plan=request.plan,
        conversation_context=_conversation_with_reply(request, message),
    )


async def orchestrate_chat(
    request: ChatRequest,
    provider: AIProvider,
) -> ChatResponse:
    validate_plan_schedule(request.plan)
    if _is_help_query(request.message):
        return ChatResponse(
            status=ChatStatus.CLARIFICATION_REQUIRED,
            message=CAPABILITY_MESSAGE,
            plan=request.plan,
            conversation_context=_conversation_with_reply(
                request, CAPABILITY_MESSAGE
            ),
        )
    if _is_clearly_generic_move(request.message):
        return ChatResponse(
            status=ChatStatus.CLARIFICATION_REQUIRED,
            message=_TARGET_CLARIFICATION,
            plan=request.plan,
            conversation_context=_conversation_with_reply(
                request, _TARGET_CLARIFICATION
            ),
        )

    planning_context = PlanningRequestContext(plan=request.plan)
    input_items = _initial_input(request)
    provider_message = ""

    with bind_planning_context(planning_context):
        async with PlanningMCPClient() as mcp_client:
            model_tools = await mcp_client.model_tools()
            for _ in range(MAX_PROVIDER_ROUNDS):
                turn = await provider.complete(
                    input_items=input_items,
                    tools=model_tools,
                )
                provider_message = turn.output_text or provider_message
                input_items.extend(turn.output_items)
                if not turn.tool_calls:
                    break
                for call in turn.tool_calls:
                    output = await mcp_client.call_tool(
                        call.name, call.arguments
                    )
                    input_items.append(
                        mcp_client.function_output(call.call_id, output)
                    )
            else:
                raise AIProviderError("AI provider exceeded the tool-call round limit")

            if planning_context.clarification_question is not None:
                message = planning_context.clarification_question
                return ChatResponse(
                    status=ChatStatus.CLARIFICATION_REQUIRED,
                    message=message,
                    plan=request.plan,
                    conversation_context=_conversation_with_reply(request, message),
                )

            if not planning_context.requested_changes:
                message = provider_message.strip() or "Уточните, какое изменение требуется."
                return ChatResponse(
                    status=ChatStatus.CLARIFICATION_REQUIRED,
                    message=message,
                    plan=request.plan,
                    conversation_context=_conversation_with_reply(request, message),
                )

            changeset = planning_context.prepare()
            if changeset.status is ChangeSetStatus.INVALID:
                message = _conflict_message(changeset)
                return ChatResponse(
                    status=ChatStatus.CLARIFICATION_REQUIRED,
                    message=message,
                    plan=request.plan,
                    conversation_context=_conversation_with_reply(request, message),
                )

            if changeset.status is ChangeSetStatus.CONFIRMATION_REQUIRED:
                message = _confirmation_message(changeset)
                return ChatResponse(
                    status=ChatStatus.CONFIRMATION_REQUIRED,
                    message=message,
                    plan=request.plan,
                    conversation_context=_conversation_with_reply(request, message),
                    pending_changeset=changeset,
                    available_options=("apply_all", "cancel"),
                )

            planning_context.apply_authorized = True
            application = await mcp_client.call_tool("apply_changes")
            if application.get("status") != "applied":
                raise AIProviderError("Authorized ChangeSet application failed")
            if planning_context.applied_plan is None:
                raise AIProviderError("Authorized ChangeSet returned no PlanState")
            message = _applied_message(
                changeset,
                request.plan,
                planning_context.applied_plan,
            )
            return ChatResponse(
                status=ChatStatus.APPLIED,
                message=message,
                plan=planning_context.applied_plan,
                conversation_context=_conversation_with_reply(request, message),
            )
