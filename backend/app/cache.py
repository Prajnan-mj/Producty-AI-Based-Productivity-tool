from __future__ import annotations

import redis.asyncio as aioredis
from redis.exceptions import RedisError

from app.config import settings

# A single shared async Redis connection pool for the app.
redis_client: aioredis.Redis = aioredis.from_url(
    settings.REDIS_URL,
    encoding="utf-8",
    decode_responses=True,
)


async def safe_get(key: str) -> str | None:
    """Get a cached value, returning None if Redis is unavailable."""
    try:
        return await redis_client.get(key)
    except (RedisError, OSError):
        return None


async def safe_set(key: str, value: str, ttl_seconds: int) -> None:
    """Set a cached value, silently ignoring Redis unavailability."""
    try:
        await redis_client.set(key, value, ex=ttl_seconds)
    except (RedisError, OSError):
        pass
