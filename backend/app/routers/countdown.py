from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import CountdownEvent, User
from app.openai_client import openai_client, LLM_MODEL
from app.security import get_current_user

router = APIRouter()

EVENT_TYPES = {"interview", "exam", "pitch", "deadline", "other"}


class EventCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=512)
    event_type: str = Field(default="other")
    event_at: datetime


class PrepStage(BaseModel):
    when: str
    items: list[str]


class EventResponse(BaseModel):
    id: uuid.UUID
    title: str
    event_type: str
    event_at: datetime
    prep_plan: list[PrepStage]
    created_at: datetime


def _resp(e: CountdownEvent) -> EventResponse:
    plan = (e.prep_plan or {}).get("stages", []) if isinstance(e.prep_plan, dict) else []
    return EventResponse(
        id=e.id, title=e.title, event_type=e.event_type, event_at=e.event_at,
        prep_plan=[PrepStage(when=str(s.get("when", "")), items=[str(x) for x in s.get("items", [])])
                   for s in plan if isinstance(s, dict)],
        created_at=e.created_at,
    )


@router.get("", response_model=list[EventResponse])
async def list_events(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[EventResponse]:
    result = await db.execute(
        select(CountdownEvent).where(CountdownEvent.user_id == user.id).order_by(CountdownEvent.event_at.asc())
    )
    return [_resp(e) for e in result.scalars().all()]


@router.post("", response_model=EventResponse)
async def create_event(
    body: EventCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> EventResponse:
    etype = body.event_type if body.event_type in EVENT_TYPES else "other"
    event = CountdownEvent(user_id=user.id, title=body.title, event_type=etype, event_at=body.event_at)
    db.add(event)
    await db.flush()
    await db.refresh(event)
    return _resp(event)


@router.delete("/{event_id}")
async def delete_event(
    event_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    event = (
        await db.execute(select(CountdownEvent).where(and_(CountdownEvent.id == event_id, CountdownEvent.user_id == user.id)))
    ).scalar_one_or_none()
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    await db.delete(event)
    await db.flush()
    return {"detail": "deleted"}


_PREP_SYSTEM = (
    "You are a prep coach for high-stakes events. Given an event type and how far away it is, "
    "produce a staged preparation plan keyed to a T-minus timeline (7 days, 3 days, 24 hours, 1 hour). "
    "Tailor the items to the event type (coding interview, exam, pitch, etc). "
    "Return strict JSON: {\"stages\": [{\"when\": \"7 days before\", \"items\": [\"...\", \"...\"]}]}."
)


@router.post("/{event_id}/prep-plan", response_model=EventResponse)
async def generate_prep_plan(
    event_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> EventResponse:
    event = (
        await db.execute(select(CountdownEvent).where(and_(CountdownEvent.id == event_id, CountdownEvent.user_id == user.id)))
    ).scalar_one_or_none()
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")

    now = datetime.now(timezone.utc)
    days_away = max((event.event_at - now).total_seconds() / 86400, 0)

    fallback = {
        "stages": [
            {"when": "7 days before", "items": ["Map out everything you need to cover", "Build a study/prep schedule"]},
            {"when": "3 days before", "items": ["Do a full practice run", "Note weak spots and drill them"]},
            {"when": "24 hours before", "items": ["Light review only — no cramming", "Prepare logistics (location, materials, sleep)"]},
            {"when": "1 hour before", "items": ["Breathe, skim your one-page summary", "Arrive early and settle in"]},
        ]
    }
    try:
        completion = await openai_client.chat.completions.create(
            model=LLM_MODEL,
            response_format={"type": "json_object"},
            temperature=0.4,
            messages=[
                {"role": "system", "content": _PREP_SYSTEM},
                {"role": "user", "content": f"Event: {event.title}\nType: {event.event_type}\nIt is about {days_away:.1f} days away."},
            ],
        )
        plan = json.loads(completion.choices[0].message.content or "{}")
        if not plan.get("stages"):
            plan = fallback
    except Exception:  # noqa: BLE001
        plan = fallback

    event.prep_plan = plan
    await db.flush()
    await db.refresh(event)
    return _resp(event)
