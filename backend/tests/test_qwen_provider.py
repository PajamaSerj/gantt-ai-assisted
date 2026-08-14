import asyncio

import pytest

from app.ai.provider import AIProviderConfigurationError
from app.ai.qwen import QwenProvider, QwenSettings


class FakeOutputItem:
    def __init__(self, data: dict) -> None:
        self.data = data

    def model_dump(self, **kwargs) -> dict:
        return self.data


class FakeResponse:
    output_text = "Prepared"
    output = [
        FakeOutputItem(
            {
                "type": "function_call",
                "call_id": "call-1",
                "name": "get_task",
                "arguments": '{"identifier":"TASK-001"}',
            }
        )
    ]


class FakeResponses:
    def __init__(self) -> None:
        self.kwargs = None

    async def create(self, **kwargs):
        self.kwargs = kwargs
        return FakeResponse()


class FakeOpenAIClient:
    def __init__(self) -> None:
        self.responses = FakeResponses()


def test_qwen_settings_require_environment_configuration() -> None:
    with pytest.raises(AIProviderConfigurationError, match="AI_MODEL"):
        QwenSettings.from_environment({})


def test_qwen_adapter_uses_responses_api_and_configured_model() -> None:
    client = FakeOpenAIClient()
    provider = QwenProvider(
        QwenSettings(
            api_key="test-key",
            folder_id="test-folder",
            model="gpt://test-folder/qwen3.6-35b-a3b",
        ),
        client=client,
    )

    turn = asyncio.run(
        provider.complete(
            input_items=[{"role": "user", "content": "Найди TASK-001"}],
            tools=[
                {
                    "type": "function",
                    "name": "get_task",
                    "description": "Read a task",
                    "parameters": {"type": "object"},
                }
            ],
        )
    )

    assert client.responses.kwargs["model"] == "gpt://test-folder/qwen3.6-35b-a3b"
    assert client.responses.kwargs["parallel_tool_calls"] is False
    assert turn.tool_calls[0].name == "get_task"
    assert turn.tool_calls[0].arguments == {"identifier": "TASK-001"}


def test_qwen_provider_sends_approved_semantic_contract() -> None:
    client = FakeOpenAIClient()
    provider = QwenProvider(
        QwenSettings(
            api_key="test-key",
            folder_id="test-folder",
            model="configured-model",
        ),
        client=client,
    )

    asyncio.run(provider.complete(input_items=[], tools=[]))

    instructions = " ".join(client.responses.kwargs["instructions"].split())
    required_rules = (
        "Task references are public IDs, never zero-based positions",
        '"задача 7", "task 7", or bare "7" means TASK-007',
        "A completed operation never establishes an implicit default task",
        'generic singular noun such as "задачу" or "task"',
        "Never inherit the last successfully changed task",
        "Explicit anaphoric continuation",
        "only when that referent is unambiguous",
        "N days means signed N working days",
        "one-week scheduling shift means exactly 5 working days",
        '"Next week" without a concrete date or weekday is ambiguous',
        'Plain wording that puts one task "after" another is ambiguous',
        "An explicit date move uses move_tasks and never creates a dependency",
        "An explicit dependency request must use add_predecessor",
        "move_tasks.after_task_identifier only for an explicitly unambiguous relative",
        "Never invent missing management data",
        "Date arithmetic, working-day calculations, dependency validation",
        "TASK-ID generation, and apply authorization",
    )
    for rule in required_rules:
        assert rule in instructions
