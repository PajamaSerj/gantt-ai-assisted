from typing import Any

from app.ai.models import (
    ChatRequest,
    ChatResponse,
    ChatStatus,
    ConversationMessage,
)
from app.ai.provider import AIProvider, AIProviderError
from app.domain.changesets import ChangeSet, ChangeSetStatus
from app.domain.validation import validate_plan_schedule
from app.mcp.client import PlanningMCPClient
from app.mcp.context import (
    PlanningRequestContext,
    bind_planning_context,
)

MAX_PROVIDER_ROUNDS = 12


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
    return "Предложенные изменения не прошли deterministic validation."


def _confirmation_message(changeset: ChangeSet, provider_message: str) -> str:
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
    prefix = provider_message.strip() or "Изменения подготовлены."
    if not details:
        return prefix
    return f"{prefix} Требуется подтверждение: {' '.join(details)}"


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
                message = _confirmation_message(changeset, provider_message)
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
            message = provider_message.strip() or "Изменения применены."
            return ChatResponse(
                status=ChatStatus.APPLIED,
                message=message,
                plan=planning_context.applied_plan,
                conversation_context=_conversation_with_reply(request, message),
            )
