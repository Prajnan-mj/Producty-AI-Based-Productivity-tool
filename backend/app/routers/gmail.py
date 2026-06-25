"""Gmail: AI-drafted email composition + sending.

Flow:
  1. POST /api/gmail/compose  → AI writes {to, subject, body} from a plain
     English request. Nothing is sent — the user reviews it first.
  2. POST /api/gmail/send     → actually sends the reviewed email via Gmail.

Requires the gmail.send scope (granted at OAuth consent). Existing users who
signed in before this scope was added must sign out and sign in again.
"""
from __future__ import annotations

import asyncio
import base64
import json
from email.mime.text import MIMEText
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.llm import genai_generate
from app.models import User
from app.security import get_current_user
from app.security_utils import wrap_untrusted

router = APIRouter()

GOOGLE_SCOPES: list[str] = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
]


def _build_credentials(user: User) -> Credentials:
    if not user.google_access_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Google account not connected — sign in again.",
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


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class ComposeRequest(BaseModel):
    instruction: str = Field(..., min_length=1, max_length=2000)
    to: str | None = None  # optional explicit recipient


class ComposeResponse(BaseModel):
    to: str
    subject: str
    body: str


class SendRequest(BaseModel):
    to: str = Field(..., pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    subject: str = Field(..., min_length=1, max_length=500)
    body: str = Field(..., min_length=1, max_length=20000)


class SendResponse(BaseModel):
    success: bool
    message: str


_COMPOSE_SYSTEM = """\
You are an email-writing assistant. From the user's request, produce a complete,
ready-to-send email. Match a professional but natural tone unless the user asks
otherwise. Keep it concise.

Return strict JSON:
{
  "to": "<recipient email if mentioned, else empty string>",
  "subject": "<a clear subject line>",
  "body": "<the full email body, with greeting and sign-off>"
}
"""


# ---------------------------------------------------------------------------
# 1. POST /compose — AI drafts the email (does NOT send)
# ---------------------------------------------------------------------------

@router.post("/compose", response_model=ComposeResponse)
async def compose_email(
    body: ComposeRequest,
    user: User = Depends(get_current_user),
) -> ComposeResponse:
    sender_name = user.name or "the user"
    prompt = (
        f"Sender's name: {sender_name}\n"
        f"Request: {wrap_untrusted(body.instruction)}"
    )
    try:
        raw = await genai_generate(_COMPOSE_SYSTEM, prompt, temperature=0.5, json_mode=True)
        data = json.loads(raw)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not draft the email right now. Try again.",
        ) from exc

    return ComposeResponse(
        to=body.to or str(data.get("to", "")).strip(),
        subject=str(data.get("subject", "")).strip() or "(no subject)",
        body=str(data.get("body", "")).strip(),
    )


# ---------------------------------------------------------------------------
# 2. POST /send — send the reviewed email
# ---------------------------------------------------------------------------

def _send_via_gmail(creds: Credentials, to: str, subject: str, body: str) -> str:
    service = build("gmail", "v1", credentials=creds, cache_discovery=False)
    message = MIMEText(body)
    message["to"] = to
    message["subject"] = subject
    raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
    sent = (
        service.users()
        .messages()
        .send(userId="me", body={"raw": raw})
        .execute()
    )
    return sent.get("id", "")


@router.post("/send", response_model=SendResponse)
async def send_email(
    body: SendRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SendResponse:
    creds = _build_credentials(user)

    # Persist a refreshed token if it changed.
    if creds.token != user.google_access_token:
        user.google_access_token = creds.token
        await db.flush()

    try:
        await asyncio.to_thread(_send_via_gmail, creds, str(body.to), body.subject, body.body)
    except Exception as exc:  # noqa: BLE001
        msg = str(exc)
        if "insufficient" in msg.lower() or "scope" in msg.lower() or "403" in msg:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Gmail send permission missing. Sign out and sign in again to grant it.",
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to send email: {msg}",
        ) from exc

    return SendResponse(success=True, message=f"Email sent to {body.to}.")
