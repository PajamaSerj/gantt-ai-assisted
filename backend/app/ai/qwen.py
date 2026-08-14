import json
import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from openai import AsyncOpenAI, OpenAIError

from app.ai.provider import (
    AIProviderConfigurationError,
    AIProviderError,
    ProviderToolCall,
    ProviderTurn,
)

DEFAULT_YANDEX_AI_BASE_URL = "https://ai.api.cloud.yandex.net/v1"

SYSTEM_INSTRUCTIONS = """You are the AI assistant for an MVP Gantt planner.
Use MCP-derived function tools to inspect the current request-scoped plan. The full
PlanState is deliberately not present in this prompt.

Apply these approved natural-language scheduling rules before selecting a tool:
- Task references are public IDs, never zero-based positions. In task-reference
  context, "задача 7", "task 7", or bare "7" means TASK-007 if it exists.
  If that public ID does not exist, ask for clarification; never select the
  eighth array element or another positional task.
- For a scheduling shift, N days means signed N working days. Pass that signed
  count to move_tasks.shift_workdays; deterministic code traverses the calendar.
- A one-week scheduling shift means exactly 5 working days.
- "Next week" without a concrete date or weekday is ambiguous. Ask for the date
  or weekday; never choose a day such as Monday for the user.
- Plain wording that puts one task "after" another is ambiguous between a relative
  date move and a dependency. Unless the user explicitly chooses one intent, ask
  whether they want a date move or a Finish-to-Start dependency.
- An explicit date move uses move_tasks and never creates a dependency. An explicit
  dependency request must use add_predecessor, remove_predecessor, or
  replace_predecessor, as appropriate.
- Use move_tasks.after_task_identifier only for an explicitly unambiguous relative
  date-move intent, never to guess the meaning of plain "after" wording.

Never invent missing management data, including task data, dates, dependencies,
duration, descriptions, or assignees.

For mutations, inspect the relevant tasks first and then call only the specialized
prepare tools. Date arithmetic, working-day calculations, dependency validation,
cycle checks, impact calculation, TASK-ID generation, and apply authorization are
owned by deterministic backend code. Do not calculate or claim those results
yourself. If required information is missing or wording is ambiguous, ask the
smallest necessary clarification question instead of choosing a management value.

Never parse Excel content; Excel import is a separate deterministic endpoint.
Never ask to call apply_changes: the backend orchestrator alone authorizes safe
AUTO_APPLICABLE application. Respond in the user's language and keep explanations
concise and human-readable.
"""


@dataclass(frozen=True, slots=True)
class QwenSettings:
    api_key: str
    folder_id: str
    model: str
    base_url: str = DEFAULT_YANDEX_AI_BASE_URL

    @classmethod
    def from_environment(
        cls, environment: Mapping[str, str] | None = None
    ) -> "QwenSettings":
        values = environment if environment is not None else os.environ
        required = {
            "YANDEX_CLOUD_API_KEY": values.get("YANDEX_CLOUD_API_KEY", "").strip(),
            "YANDEX_CLOUD_FOLDER_ID": values.get(
                "YANDEX_CLOUD_FOLDER_ID", ""
            ).strip(),
            "AI_MODEL": values.get("AI_MODEL", "").strip(),
        }
        missing = [name for name, value in required.items() if not value]
        if missing:
            raise AIProviderConfigurationError(
                "Missing AI provider settings: " + ", ".join(missing)
            )
        return cls(
            api_key=required["YANDEX_CLOUD_API_KEY"],
            folder_id=required["YANDEX_CLOUD_FOLDER_ID"],
            model=required["AI_MODEL"],
            base_url=(
                values.get("AI_BASE_URL", DEFAULT_YANDEX_AI_BASE_URL).strip()
                or DEFAULT_YANDEX_AI_BASE_URL
            ),
        )


class QwenProvider:
    """Thin OpenAI Responses adapter for Qwen in Yandex AI Studio."""

    def __init__(
        self,
        settings: QwenSettings,
        *,
        client: AsyncOpenAI | None = None,
    ) -> None:
        self._settings = settings
        self._client = client or AsyncOpenAI(
            api_key=settings.api_key,
            base_url=settings.base_url,
            project=settings.folder_id,
        )

    @classmethod
    def from_environment(cls) -> "QwenProvider":
        return cls(QwenSettings.from_environment())

    async def complete(
        self,
        *,
        input_items: Sequence[dict[str, Any]],
        tools: Sequence[dict[str, Any]],
    ) -> ProviderTurn:
        try:
            response = await self._client.responses.create(
                model=self._settings.model,
                instructions=SYSTEM_INSTRUCTIONS,
                input=list(input_items),
                tools=list(tools),
                parallel_tool_calls=False,
            )
        except (OpenAIError, OSError, TimeoutError) as error:
            raise AIProviderError(f"AI provider request failed: {error}") from error

        output_items: list[dict[str, Any]] = []
        tool_calls: list[ProviderToolCall] = []
        for item in response.output:
            dumped = item.model_dump(mode="json", exclude_none=True)
            output_items.append(dumped)
            if dumped.get("type") != "function_call":
                continue
            raw_arguments = dumped.get("arguments", "{}")
            try:
                arguments = json.loads(raw_arguments)
            except (TypeError, json.JSONDecodeError) as error:
                raise AIProviderError(
                    f"AI provider returned invalid tool arguments for "
                    f"{dumped.get('name', '<unknown>')}"
                ) from error
            if not isinstance(arguments, dict):
                raise AIProviderError("AI provider tool arguments must be an object")
            tool_calls.append(
                ProviderToolCall(
                    call_id=str(dumped["call_id"]),
                    name=str(dumped["name"]),
                    arguments=arguments,
                )
            )
        return ProviderTurn(
            output_text=(response.output_text or "").strip(),
            output_items=tuple(output_items),
            tool_calls=tuple(tool_calls),
        )
