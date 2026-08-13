from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator

from app.domain.changesets import ChangeSet
from app.domain.models import PlanState


class ChatStatus(StrEnum):
    APPLIED = "applied"
    CLARIFICATION_REQUIRED = "clarification_required"
    CONFIRMATION_REQUIRED = "confirmation_required"
    PROVIDER_ERROR = "provider_error"


class ConversationMessage(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    role: Literal["user", "assistant"]
    content: str

    @field_validator("content")
    @classmethod
    def validate_content(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("conversation message must not be empty")
        return normalized


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    message: str
    plan: PlanState
    conversation_context: tuple[ConversationMessage, ...] = ()

    @field_validator("message")
    @classmethod
    def validate_message(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("message must not be empty")
        return normalized


class ChatResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    status: ChatStatus
    message: str
    plan: PlanState
    conversation_context: tuple[ConversationMessage, ...]
    pending_changeset: ChangeSet | None = None
    available_options: tuple[str, ...] = ()
