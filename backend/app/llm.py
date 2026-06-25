"""Resilient LLM wrapper — routes through the OpenAI-compatible client.

Works with NVIDIA NIM, Gemini, or any OpenAI-compatible endpoint. Retry with
exponential backoff on transient errors. Multimodal (image/PDF) inputs are
only supported when the underlying provider supports them.
"""
from __future__ import annotations

import asyncio
import json
from typing import Any

from openai import APIError, RateLimitError, APITimeoutError, APIConnectionError

from app.config import settings
from app.openai_client import openai_client, LLM_MODEL

_RETRY_EXC = (RateLimitError, APITimeoutError, APIConnectionError)
_MAX_ATTEMPTS = 4
_BASE_DELAY = 1.5


async def genai_generate(
    system: str,
    contents: Any,
    *,
    temperature: float = 0.4,
    json_mode: bool = True,
    max_output_tokens: int | None = None,
) -> str:
    """Generate text via the OpenAI-compatible client with retries.

    ``contents`` can be:
      - a string (text prompt)
      - a list with dicts for multimodal (only works with providers that support it)
    Returns the raw response text.
    """
    messages: list[dict[str, Any]] = [{"role": "system", "content": system}]

    if isinstance(contents, str):
        messages.append({"role": "user", "content": contents})
    elif isinstance(contents, list):
        # Multimodal: try to convert image/PDF parts to text description
        # since NVIDIA NIM doesn't support raw binary parts via OpenAI API.
        # Extract text parts and describe binary parts.
        text_parts = []
        for part in contents:
            if isinstance(part, str):
                text_parts.append(part)
            elif isinstance(part, dict):
                mime = part.get("mime_type", "")
                if "text" in mime or not part.get("data"):
                    text_parts.append(str(part.get("data", "")))
                else:
                    text_parts.append(f"[Attached file: {mime}]")
        messages.append({"role": "user", "content": "\n".join(text_parts)})
    else:
        messages.append({"role": "user", "content": str(contents)})

    kwargs: dict[str, Any] = {
        "model": LLM_MODEL,
        "messages": messages,
        "temperature": temperature,
    }
    if max_output_tokens:
        kwargs["max_tokens"] = max_output_tokens

    # NVIDIA NIM supports response_format for JSON mode
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}

    last_exc: Exception | None = None
    for attempt in range(_MAX_ATTEMPTS):
        try:
            completion = await openai_client.chat.completions.create(**kwargs)
            if not completion.choices:
                raise RuntimeError(f"LLM returned empty choices. Full response: {completion}")
            return (completion.choices[0].message.content or "").strip()
        except _RETRY_EXC as exc:
            last_exc = exc
            if attempt < _MAX_ATTEMPTS - 1:
                await asyncio.sleep(_BASE_DELAY * (2 ** attempt))
            continue
        except APIError as exc:
            raise

    if last_exc is not None:
        raise last_exc
    raise RuntimeError("LLM call failed")
