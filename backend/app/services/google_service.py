from __future__ import annotations

import asyncio
import base64
import json
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from pydantic import BaseModel
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Task, User
from app.openai_client import openai_client, LLM_MODEL

# Both scopes are listed so a single Credentials object works for any Google
# API call. The actual access is governed by what the user granted at consent.
GOOGLE_SCOPES: list[str] = [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/gmail.readonly",
]

GMAIL_KEYWORDS: list[str] = [
    "action required",
    "deadline",
    "by tomorrow",
    "please complete",
    "task assigned",
    "due date",
    "reminder",
    "urgent",
]

_VALID_PRIORITIES: set[str] = {"high", "medium", "low"}


class ExtractedTask(BaseModel):
    task_title: str
    deadline: datetime | None = None
    priority: str = "medium"
    source_email: str
    source_email_id: str


# ---------------------------------------------------------------------------
# Google auth
# ---------------------------------------------------------------------------

def _build_credentials(user: User) -> Credentials:
    if not user.google_access_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Google account not connected — please login via /api/auth/google/login",
        )
    creds = Credentials(
        token=user.google_access_token,
        refresh_token=user.google_refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
        scopes=GOOGLE_SCOPES,
    )
    if creds.expired and creds.refresh_token:
        creds.refresh(GoogleRequest())
    return creds


def _persist_refreshed_token(creds: Credentials, user: User) -> None:
    """Mutate the user row with a refreshed token (caller commits)."""
    if creds.token != user.google_access_token:
        user.google_access_token = creds.token
        expiry = creds.expiry
        if expiry is not None and expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=timezone.utc)
        user.google_token_expiry = expiry


# ---------------------------------------------------------------------------
# Gmail helpers (blocking — run via asyncio.to_thread)
# ---------------------------------------------------------------------------

def _gmail_search(creds: Credentials, max_results: int) -> list[dict[str, Any]]:
    service = build("gmail", "v1", credentials=creds, cache_discovery=False)
    query = " OR ".join(f'"{kw}"' for kw in GMAIL_KEYWORDS)

    listed = (
        service.users()
        .messages()
        .list(userId="me", q=query, maxResults=max_results)
        .execute()
    )
    message_refs: list[dict[str, str]] = listed.get("messages", [])

    messages: list[dict[str, Any]] = []
    for ref in message_refs:
        msg = (
            service.users()
            .messages()
            .get(
                userId="me",
                id=ref["id"],
                format="metadata",
                metadataHeaders=["Subject", "From", "Date"],
            )
            .execute()
        )
        messages.append(msg)
    return messages


def _header(msg: dict[str, Any], name: str) -> str:
    headers = msg.get("payload", {}).get("headers", [])
    for h in headers:
        if h.get("name", "").lower() == name.lower():
            return h.get("value", "")
    return ""


def _received_datetime(msg: dict[str, Any]) -> datetime | None:
    internal = msg.get("internalDate")
    if internal is None:
        return None
    try:
        return datetime.fromtimestamp(int(internal) / 1000, tz=timezone.utc)
    except (ValueError, TypeError):
        return None


# ---------------------------------------------------------------------------
# OpenAI extraction
# ---------------------------------------------------------------------------

_EXTRACTION_SYSTEM_PROMPT = (
    "You extract a single actionable task from an email. "
    "Return strict JSON with keys: task_title (string), deadline (ISO 8601 "
    "datetime string or null), priority (one of 'high','medium','low'), "
    "is_actionable (boolean). "
    "If the email contains no concrete task the recipient must act on, set "
    "is_actionable to false."
)


async def _extract_task_with_openai(
    client: Any,
    subject: str,
    sender: str,
    snippet: str,
) -> dict[str, Any] | None:
    user_content = (
        f"Subject: {subject}\n"
        f"From: {sender}\n"
        f"Snippet: {snippet}\n\n"
        "Extract the actionable task as JSON."
    )

    completion = await client.chat.completions.create(
        model=LLM_MODEL,
        response_format={"type": "json_object"},
        temperature=0,
        messages=[
            {"role": "system", "content": _EXTRACTION_SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
    )

    raw = completion.choices[0].message.content
    if not raw:
        return None

    try:
        data: dict[str, Any] = json.loads(raw)
    except json.JSONDecodeError:
        return None

    if not data.get("is_actionable") or not data.get("task_title"):
        return None
    return data


def _parse_deadline(value: Any) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _normalize_priority(value: Any) -> str:
    if isinstance(value, str) and value.lower() in _VALID_PRIORITIES:
        return value.lower()
    return "medium"


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

async def extract_tasks_from_gmail(
    user: User,
    db: AsyncSession,
    max_results: int = 20,
) -> list[ExtractedTask]:
    """Search Gmail for actionable emails, extract tasks via GPT-4o-mini,
    upsert them into the tasks table, and return the extracted tasks."""
    creds = _build_credentials(user)
    _persist_refreshed_token(creds, user)

    messages = await asyncio.to_thread(_gmail_search, creds, max_results)

    extracted: list[ExtractedTask] = []

    for msg in messages:
        message_id: str = msg["id"]
        subject = _header(msg, "Subject")
        sender = _header(msg, "From")
        snippet = msg.get("snippet", "")
        date_received = _received_datetime(msg)

        data = await _extract_task_with_openai(openai_client, subject, sender, snippet)
        if data is None:
            continue  # No actionable task in this email.

        deadline = _parse_deadline(data.get("deadline"))
        priority = _normalize_priority(data.get("priority"))
        title = str(data["task_title"]).strip()

        result = await db.execute(
            select(Task).where(
                and_(
                    Task.user_id == user.id,
                    Task.source_email_id == message_id,
                )
            )
        )
        existing = result.scalar_one_or_none()

        description = f"From email: {subject} (received {date_received})"

        if existing is None:
            task = Task(
                user_id=user.id,
                title=title,
                description=description,
                deadline=deadline,
                priority=priority,
                status="pending",
                source="gmail",
                source_email_id=message_id,
            )
            db.add(task)
        else:
            existing.title = title
            existing.description = description
            existing.deadline = deadline
            existing.priority = priority

        extracted.append(
            ExtractedTask(
                task_title=title,
                deadline=deadline,
                priority=priority,
                source_email=sender,
                source_email_id=message_id,
            )
        )

    await db.flush()
    return extracted
