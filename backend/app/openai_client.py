"""Unified OpenAI-compatible client.

Points at whichever provider is configured: NVIDIA NIM (default), Gemini, or
raw OpenAI. Every router that does `from app.openai_client import openai_client`
gets the right client automatically.
"""
from openai import AsyncOpenAI
from app.config import settings

NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1"
GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"

LLM_MODEL = settings.active_model

if settings.NVIDIA_API_KEY:
    openai_client = AsyncOpenAI(
        api_key=settings.NVIDIA_API_KEY,
        base_url=NVIDIA_BASE_URL,
        max_retries=4,
        timeout=60.0,
    )
elif settings.GEMINI_API_KEY:
    openai_client = AsyncOpenAI(
        api_key=settings.GEMINI_API_KEY,
        base_url=GEMINI_BASE_URL,
        max_retries=5,
        timeout=60.0,
    )
else:
    openai_client = AsyncOpenAI(
        api_key=settings.OPENAI_API_KEY or "no-key",
        max_retries=5,
        timeout=60.0,
    )

# --- NVIDIA Empty Choices Interceptor ---
# NIM occasionally returns empty choices (e.g. content filter or safety policy).
# This monkey-patch intercepts it so `completion.choices[0]` never throws IndexError.
_orig_create = openai_client.chat.completions.create

async def _safe_create(*args, **kwargs):
    res = await _orig_create(*args, **kwargs)
    
    if kwargs.get("stream"):
        async def _safe_stream():
            from openai.types.chat.chat_completion_chunk import Choice, ChoiceDelta
            async for chunk in res:
                if hasattr(chunk, "choices") and not chunk.choices:
                    fake_delta = ChoiceDelta(content="")
                    fake_choice = Choice(index=0, delta=fake_delta, finish_reason=None)
                    chunk.choices.append(fake_choice)
                yield chunk
        return _safe_stream()
    else:
        if hasattr(res, "choices") and not res.choices:
            from openai.types.chat.chat_completion import Choice
            from openai.types.chat.chat_completion_message import ChatCompletionMessage
            fake_msg = ChatCompletionMessage(content="", role="assistant")
            fake_choice = Choice(finish_reason="stop", index=0, message=fake_msg)
            res.choices.append(fake_choice)
        return res

# Apply patch
openai_client.chat.completions.create = _safe_create
