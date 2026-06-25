from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from sqlalchemy import text

from app.config import settings
from app.database import engine, Base
from app.security_utils import RateLimitMiddleware
from app import models  # noqa: F401  (ensures models are registered on Base.metadata)
from app.routers import (
    auth,
    calendar,
    tasks,
    deadlines,
    bills,
    habits,
    goals,
    voice,
    ai,
    documents,
    journal,
    notes,
    panic,
    countdown,
    rooms,
    mood,
    flashcards,
    triage,
    capture,
    infra,
)


import logging

logger = logging.getLogger("producty")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    logger.info("Starting Producty — DEBUG=%s", settings.DEBUG)
    if not settings.DEBUG:
        if settings.SECRET_KEY in ("change-me-in-production", "") or len(settings.SECRET_KEY) < 32:
            raise RuntimeError(
                "SECRET_KEY must be a strong random value (>=32 chars) in production. "
                "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
            )
        if not settings.cors_origins:
            logger.warning("CORS_ALLOW_ORIGINS is empty — only FRONTEND_URL (%s) will be allowed", settings.FRONTEND_URL)
    logger.info("CORS origins: %s", settings.cors_origins)
    logger.info("Database: %s", settings.async_database_url[:30] + "...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # create_all won't ALTER existing tables — add new note columns idempotently.
        for ddl in (
            "ALTER TABLE notes ADD COLUMN IF NOT EXISTS emoji VARCHAR(16) NOT NULL DEFAULT '📄'",
            "ALTER TABLE notes ADD COLUMN IF NOT EXISTS cover_gradient VARCHAR(64)",
            "ALTER TABLE notes ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT FALSE",
            "ALTER TABLE notes ADD COLUMN IF NOT EXISTS word_count INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_rule VARCHAR(32) NOT NULL DEFAULT 'none'",
            "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_interval INTEGER NOT NULL DEFAULT 1",
            "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_task_id UUID",
            "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tags TEXT",
        ):
            await conn.execute(text(ddl))
    yield
    await engine.dispose()


# In production set DEBUG=false; docs/redoc are then disabled to avoid exposing
# the full API surface and schema.
_docs_url = "/docs" if settings.DEBUG else None
_redoc_url = "/redoc" if settings.DEBUG else None
app = FastAPI(
    title="Producty", version="0.1.0", lifespan=lifespan,
    docs_url=_docs_url, redoc_url=_redoc_url, openapi_url="/openapi.json" if settings.DEBUG else None,
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add baseline security headers to every response."""
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(self), camera=()"
        # API returns JSON only — a strict CSP is safe there. Don't apply it to
        # /docs (Swagger UI needs CDN scripts/styles to render).
        if request.url.path.startswith("/api") or request.url.path == "/health":
            response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
        if not settings.DEBUG:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response


# Order matters: rate limit first (cheapest rejection), then headers, then CORS.
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RateLimitMiddleware)

# CORS: explicit allowlist in prod; permissive localhost regex only in DEBUG.
if settings.DEBUG:
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(calendar.router, prefix="/api/calendar", tags=["calendar"])
app.include_router(tasks.router, prefix="/api/tasks", tags=["tasks"])
app.include_router(deadlines.router, prefix="/api/deadlines", tags=["deadlines"])
app.include_router(bills.router, prefix="/api/bills", tags=["bills"])
app.include_router(habits.router, prefix="/api/habits", tags=["habits"])
app.include_router(goals.router, prefix="/api/goals", tags=["goals"])
app.include_router(voice.router, prefix="/api/voice", tags=["voice"])
app.include_router(ai.router, prefix="/api/ai", tags=["ai"])
app.include_router(documents.router, prefix="/api/documents", tags=["documents"])
app.include_router(journal.router, prefix="/api/journal", tags=["journal"])
app.include_router(notes.router, prefix="/api/notes", tags=["notes"])
app.include_router(panic.router, prefix="/api/panic", tags=["panic"])
app.include_router(countdown.router, prefix="/api/countdown", tags=["countdown"])
app.include_router(rooms.router, prefix="/api/rooms", tags=["rooms"])
app.include_router(mood.router, prefix="/api/mood", tags=["mood"])
app.include_router(flashcards.router, prefix="/api/flashcards", tags=["flashcards"])
app.include_router(triage.router, prefix="/api/triage", tags=["triage"])
app.include_router(capture.router, prefix="/api/capture", tags=["capture"])
app.include_router(infra.router, prefix="/api/infra", tags=["infra"])


@app.get("/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}
