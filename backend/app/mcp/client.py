import json
from types import TracebackType
from typing import Any, Self

from mcp import Client

from app.mcp.server import planning_mcp

MODEL_TOOL_NAMES = {
    "get_tasks",
    "get_task",
    "get_dependencies",
    "create_task",
    "update_task",
    "move_tasks",
    "set_assignee",
    "add_predecessor",
    "remove_predecessor",
    "replace_predecessor",
}


class PlanningMCPClient:
    """Small typed wrapper around the official in-process MCP v2 client."""

    def __init__(self) -> None:
        self._client = Client(planning_mcp, raise_exceptions=False)

    async def __aenter__(self) -> Self:
        await self._client.__aenter__()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> bool | None:
        if exc_value is not None:
            await self._client.__aexit__(None, None, None)
            return False
        return await self._client.__aexit__(exc_type, exc_value, traceback)

    async def model_tools(self) -> tuple[dict[str, Any], ...]:
        result = await self._client.list_tools()
        return tuple(
            {
                "type": "function",
                "name": tool.name,
                "description": tool.description or "",
                "parameters": tool.input_schema,
            }
            for tool in result.tools
            if tool.name in MODEL_TOOL_NAMES
        )

    async def call_tool(
        self, name: str, arguments: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        result = await self._client.call_tool(name, arguments or {})
        if result.is_error:
            message = "MCP tool failed"
            for content in result.content:
                text = getattr(content, "text", None)
                if text:
                    message = text
                    break
            return {"status": "error", "message": message}
        if result.structured_content is not None:
            return dict(result.structured_content)
        return {
            "status": "ok",
            "content": [
                content.model_dump(mode="json")
                for content in result.content
            ],
        }

    @staticmethod
    def function_output(call_id: str, output: dict[str, Any]) -> dict[str, Any]:
        return {
            "type": "function_call_output",
            "call_id": call_id,
            "output": json.dumps(output, ensure_ascii=False, sort_keys=True),
        }
