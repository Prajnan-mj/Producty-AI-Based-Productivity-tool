"""Feature 1: Universal Capture Inbox.

Accepts raw text, images, or voice transcripts. AI extracts actionable items.
High-confidence items auto-create tasks/events/bills. Low-confidence items
go to the review queue (capture_items table) for the user to approve/dismiss.
"""
from __future__ import annotations

import base64
import json
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.llm import genai_generate
from app.models import Bill, CaptureItem, Meeting, Task, User
from app.security import get_current_user
from app.security_utils import validate_upload, wrap_untrusted

router = APIRouter()

CONFIDENCE_THRESHOLD = 0.6

_CAPTURE_SYSTEM = (
    "You are a universal capture parser. Given unstructured input (text, OCR'd "
    "image, or speech transcript), extract zero or more actionable items. For "
    "each item return: {title, type: task|event|bill|reminder, deadline_iso "
    "or null, confidence: 0-1, source_snippet}. If the input contains no "
    "actionable content, return an empty list. Do not invent deadlines that "
    "aren't stated or strongly implied (e.g. 'next Friday' relative to today's "
    "date: {today}).\n\n"
    'Return strict JSON: {"items": [...]}'
)


class CapturedItem(BaseModel):
    title: str
    item_type: str
    deadline: str | None = None
    confidence: float
    source_snippet: str | None = None
    auto_created: bool = False
    review_id: uuid.UUID | None = None


class CaptureResponse(BaseModel):
    created: list[CapturedItem]
    needs_review: list[CapturedItem]


class ReviewAction(BaseModel):
    action: str = Field(..., pattern=r"^(approve|dismiss)$")


class CaptureItemOut(BaseModel):
    id: uuid.UUID
    title: str
    item_type: str
    deadline: datetime | None
    confidence: float
    source_snippet: str | None
    status: str


def _parse_dt(v: Any) -> datetime | None:
    if not v or not isinstance(v, str):
        return None
    try:
        dt = datetime.fromisoformat(v.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        return None


async def _auto_create(item: dict, user: User, db: AsyncSession) -> None:
    t = item.get("type", "task")
    title = str(item.get("title", "")).strip()
    deadline = _parse_dt(item.get("deadline_iso"))

    if t in ("task", "reminder"):
        db.add(Task(
            user_id=user.id, title=title, deadline=deadline,
            priority="medium", status="pending", source="capture",
        ))
    elif t == "event":
        from datetime import timedelta
        start = deadline or datetime.now(timezone.utc) + timedelta(days=1)
        db.add(Meeting(
            user_id=user.id, google_event_id=f"capture_{int(datetime.now(timezone.utc).timestamp())}",
            title=title, start_time=start, end_time=start + timedelta(hours=1),
            category="professional", attendee_count=0,
        ))
    elif t == "bill":
        due = deadline or datetime.now(timezone.utc)
        db.add(Bill(
            user_id=user.id, name=title, amount=0, currency="INR",
            due_date=due, recurrence="one-time", category="other",
            platform="capture", status="pending",
        ))


@router.post("/parse", response_model=CaptureResponse)
async def capture_parse(
    text: str = Form(default=""),
    file: UploadFile | None = File(default=None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CaptureResponse:
    today = datetime.now(timezone.utc).date().isoformat()
    system = _CAPTURE_SYSTEM.replace("{today}", today)

    _MAX = 10 * 1024 * 1024
    contents: Any
    if file and file.filename:
        if file.size is not None and file.size > _MAX:
            raise HTTPException(status_code=413, detail="File too large (max 10MB)")
        # Chunked read with a hard cap (a lying Content-Length can't OOM us).
        raw, total = [], 0
        while True:
            chunk = await file.read(64 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > _MAX:
                raise HTTPException(status_code=413, detail="File too large (max 10MB)")
            raw.append(chunk)
        raw = b"".join(raw)

        ext = (file.filename.rsplit(".", 1)[-1] if "." in file.filename else "").lower()
        if ext in ("png", "jpg", "jpeg", "gif", "webp"):
            validate_upload(raw, ext)
            mime = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
                    "gif": "image/gif", "webp": "image/webp"}.get(ext, "image/png")
            img_part = {"mime_type": mime, "data": raw}
            contents = [f"User note: {wrap_untrusted(text)}\n\nExtract actionable items from this image.", img_part]
        elif ext == "pdf":
            validate_upload(raw, ext)
            contents = [f"User note: {wrap_untrusted(text)}\n\nExtract actionable items from this document.",
                        {"mime_type": "application/pdf", "data": raw}]
        else:
            try:
                decoded = raw.decode("utf-8", errors="ignore")
            except Exception:
                raise HTTPException(status_code=415, detail="Unsupported file type")
            # Untrusted document content — wrap so the model treats it as data.
            contents = f"Extract actionable items from the following:\n{wrap_untrusted(decoded[:30000])}"
    elif text.strip():
        contents = f"Extract actionable items from the following:\n{wrap_untrusted(text.strip())}"
    else:
        raise HTTPException(status_code=400, detail="Provide text or a file")

    try:
        raw_resp = await genai_generate(system, contents, temperature=0.2)
        data = json.loads(raw_resp)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=503, detail="AI parsing is unavailable right now")

    items = data.get("items", data if isinstance(data, list) else [])
    created: list[CapturedItem] = []
    needs_review: list[CapturedItem] = []

    for it in items:
        if not isinstance(it, dict):
            continue
        title = str(it.get("title", "")).strip()
        if not title:
            continue
        conf = min(1.0, max(0.0, float(it.get("confidence", 0.5))))
        item_type = str(it.get("type", "task"))
        if item_type not in ("task", "event", "bill", "reminder"):
            item_type = "task"
        deadline_str = it.get("deadline_iso")
        snippet = str(it.get("source_snippet", ""))[:500] if it.get("source_snippet") else None

        if conf >= CONFIDENCE_THRESHOLD:
            await _auto_create(it, user, db)
            created.append(CapturedItem(
                title=title, item_type=item_type, deadline=deadline_str,
                confidence=conf, source_snippet=snippet, auto_created=True,
            ))
        else:
            review = CaptureItem(
                user_id=user.id, title=title, item_type=item_type,
                deadline=_parse_dt(deadline_str), confidence=conf,
                source_snippet=snippet,
            )
            db.add(review)
            await db.flush()
            await db.refresh(review)
            needs_review.append(CapturedItem(
                title=title, item_type=item_type, deadline=deadline_str,
                confidence=conf, source_snippet=snippet, review_id=review.id,
            ))

    await db.flush()
    return CaptureResponse(created=created, needs_review=needs_review)


@router.get("/review", response_model=list[CaptureItemOut])
async def list_review_queue(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[CaptureItemOut]:
    rows = (
        await db.execute(
            select(CaptureItem).where(
                and_(CaptureItem.user_id == user.id, CaptureItem.status == "pending")
            ).order_by(CaptureItem.created_at.desc())
        )
    ).scalars().all()
    return [CaptureItemOut(
        id=r.id, title=r.title, item_type=r.item_type, deadline=r.deadline,
        confidence=r.confidence, source_snippet=r.source_snippet, status=r.status,
    ) for r in rows]


@router.post("/review/{item_id}")
async def act_on_review(
    item_id: uuid.UUID,
    body: ReviewAction,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    item = (
        await db.execute(
            select(CaptureItem).where(
                and_(CaptureItem.id == item_id, CaptureItem.user_id == user.id)
            )
        )
    ).scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="Review item not found")

    if body.action == "approve":
        await _auto_create(
            {"title": item.title, "type": item.item_type,
             "deadline_iso": item.deadline.isoformat() if item.deadline else None},
            user, db,
        )
        item.status = "approved"
    else:
        item.status = "dismissed"

    await db.flush()
    return {"detail": f"Item {body.action}d"}
