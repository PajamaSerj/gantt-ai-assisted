from collections.abc import Sequence
from typing import Any, Protocol

from pydantic import BaseModel, ConfigDict


class AIProviderError(RuntimeError):
    """Provider request or response failed without changing PlanState."""


class AIProviderConfigurationError(AIProviderError):
    """Required environment configuration is absent or invalid."""


class ProviderToolCall(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    call_id: str
    name: str
    arguments: dict[str, Any]


class ProviderTurn(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    output_text: str = ""
    output_items: tuple[dict[str, Any], ...] = ()
    tool_calls: tuple[ProviderToolCall, ...] = ()


class AIProvider(Protocol):
    async def complete(
        self,
        *,
        input_items: Sequence[dict[str, Any]],
        tools: Sequence[dict[str, Any]],
    ) -> ProviderTurn: ...
