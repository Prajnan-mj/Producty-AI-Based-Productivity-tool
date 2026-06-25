from __future__ import annotations

from app.config import settings

redis_client = None

if settings.REDIS_URL:
    try:
        import redis.asyncio as aioredis
        redis_client = aioredis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
        )
    except Exception:
        redis_client = None


async def safe_get(key: str) -> str | None:
    if redis_client is None:
        return None
    try:
        return await redis_client.get(key)
    except Exception:
        return None


async def safe_set(key: str, value: str, ttl_seconds: int) -> None:
    if redis_client is None:
        return
    try:
        await redis_client.set(key, value, ex=ttl_seconds)
    except Exception:
        pass
