from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.ai.models import ChatRequest, ChatResponse
from app.ai.provider import (
    AIProvider,
    AIProviderConfigurationError,
    AIProviderError,
)
from app.ai.qwen import QwenProvider
from app.services.chat import orchestrate_chat, provider_error_response

router = APIRouter(prefix="/api", tags=["ai"])


def _provider_for(request: Request) -> AIProvider:
    override = getattr(request.app.state, "ai_provider", None)
    if override is not None:
        return override
    return QwenProvider.from_environment()


@router.post(
    "/chat",
    response_model=ChatResponse,
    responses={502: {"model": ChatResponse}, 503: {"model": ChatResponse}},
)
async def chat(
    payload: ChatRequest, request: Request
) -> ChatResponse | JSONResponse:
    try:
        provider = _provider_for(request)
        return await orchestrate_chat(payload, provider)
    except AIProviderError as error:
        response = provider_error_response(payload, str(error))
        status_code = (
            503 if isinstance(error, AIProviderConfigurationError) else 502
        )
        return JSONResponse(
            status_code=status_code,
            content=response.model_dump(mode="json"),
        )
