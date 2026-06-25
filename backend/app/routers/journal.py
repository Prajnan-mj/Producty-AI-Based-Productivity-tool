from __future__ import annotations

import uuid
from datetime import date as date_type
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from openai import APIError, RateLimitError
from pydantic import BaseModel, Field
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import HabitLog, JournalEntry, Meeting, Task, User
from app.openai_client import openai_client, LLM_MODEL
from app.security import get_current_user

router = APIRouter()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class JournalUpsert(BaseModel):
    content: str = Field(default="", max_length=20000)
    mood: str | None = None


class JournalResponse(BaseModel):
    id: uuid.UUID
    entry_date: date_type
    content: str
    ai_summary: str | None
    mood: str | None
    created_at: datetime
    updated_at: datetime


class WrappedStat(BaseModel):
    label: str
    value: str


class WeeklyWrapped(BaseModel):
    headline: str
    summary: str
    stats: list[WrappedStat]
    highlights: list[str]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _to_response(e: JournalEntry) -> JournalResponse:
    return JournalResponse(
        id=e.id,
        entry_date=e.entry_date,
        content=e.content,
        ai_summary=e.ai_summary,
        mood=e.mood,
        created_at=e.created_at,
        updated_at=e.updated_at,
    )


async def _gather_day_activity(
    user_id: uuid.UUID, day: date_type, db: AsyncSession
) -> dict[str, list[str]]:
    start = datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc)
    end = start + timedelta(days=1)

    completed = (
        await db.execute(
            select(Task.title).where(
                and_(
                    Task.user_id == user_id,
                    Task.status == "done",
                    Task.updated_at >= start,
                    Task.updated_at < end,
                )
            )
        )
    ).scalars().all()

    habit_logs = (
        await db.execute(
            select(HabitLog.id).where(
                and_(HabitLog.user_id == user_id, HabitLog.period_date == day)
            )
        )
    ).all()

    meetings = (
        await db.execute(
            select(Meeting.title).where(
                and_(
                    Meeting.user_id == user_id,
                    Meeting.start_time >= start,
                    Meeting.start_time < end,
                )
            )
        )
    ).scalars().all()

    return {
        "completed_tasks": list(completed),
        "habits_completed_count": [str(len(habit_logs))],
        "meetings": list(meetings),
    }


# ---------------------------------------------------------------------------
# 1. GET /journal  — list recent entries
# ---------------------------------------------------------------------------

@router.get("", response_model=list[JournalResponse])
async def list_journal(
    days: int = Query(default=30, ge=1, le=365),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[JournalResponse]:
    since = date_type.today() - timedelta(days=days)
    result = await db.execute(
        select(JournalEntry)
        .where(and_(JournalEntry.user_id == user.id, JournalEntry.entry_date >= since))
        .order_by(JournalEntry.entry_date.desc())
    )
    return [_to_response(e) for e in result.scalars().all()]


# ---------------------------------------------------------------------------
# 2. GET /journal/{entry_date}  — fetch one day (empty if none)
# ---------------------------------------------------------------------------

@router.get("/{entry_date}", response_model=JournalResponse)
async def get_journal(
    entry_date: date_type,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> JournalResponse:
    result = await db.execute(
        select(JournalEntry).where(
            and_(JournalEntry.user_id == user.id, JournalEntry.entry_date == entry_date)
        )
    )
    entry = result.scalar_one_or_none()
    if entry is None:
        # Return a transient empty entry (not persisted until written).
        return JournalResponse(
            id=uuid.uuid4(),
            entry_date=entry_date,
            content="",
            ai_summary=None,
            mood=None,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
    return _to_response(entry)


# ---------------------------------------------------------------------------
# 3. PUT /journal/{entry_date}  — upsert content
# ---------------------------------------------------------------------------

@router.put("/{entry_date}", response_model=JournalResponse)
async def upsert_journal(
    entry_date: date_type,
    body: JournalUpsert,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> JournalResponse:
    result = await db.execute(
        select(JournalEntry).where(
            and_(JournalEntry.user_id == user.id, JournalEntry.entry_date == entry_date)
        )
    )
    entry = result.scalar_one_or_none()
    if entry is None:
        entry = JournalEntry(
            user_id=user.id, entry_date=entry_date, content=body.content, mood=body.mood
        )
        db.add(entry)
    else:
        entry.content = body.content
        if body.mood is not None:
            entry.mood = body.mood
    await db.flush()
    await db.refresh(entry)
    return _to_response(entry)


# ---------------------------------------------------------------------------
# 4. POST /journal/{entry_date}/summarize  — AI day summary
# ---------------------------------------------------------------------------

@router.post("/{entry_date}/summarize", response_model=JournalResponse)
async def summarize_day(
    entry_date: date_type,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> JournalResponse:
    result = await db.execute(
        select(JournalEntry).where(
            and_(JournalEntry.user_id == user.id, JournalEntry.entry_date == entry_date)
        )
    )
    entry = result.scalar_one_or_none()
    if entry is None:
        entry = JournalEntry(user_id=user.id, entry_date=entry_date, content="")
        db.add(entry)
        await db.flush()

    activity = await _gather_day_activity(user.id, entry_date, db)

    prompt = (
        f"Date: {entry_date.isoformat()}\n"
        f"Completed tasks: {', '.join(activity['completed_tasks']) or 'none'}\n"
        f"Habits completed: {activity['habits_completed_count'][0]}\n"
        f"Meetings: {', '.join(activity['meetings']) or 'none'}\n"
        f"Journal notes: {entry.content or 'none'}\n\n"
        "Write a warm, encouraging 2-3 sentence reflection of what this person "
        "accomplished today. Be specific and motivating, not generic."
    )

    try:
        completion = await openai_client.chat.completions.create(
            model=LLM_MODEL,
            temperature=0.6,
            max_tokens=200,
            messages=[
                {"role": "system", "content": "You are a supportive daily reflection coach."},
                {"role": "user", "content": prompt},
            ],
        )
        entry.ai_summary = (completion.choices[0].message.content or "").strip()
    except (RateLimitError, APIError) as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"AI summary unavailable (OpenAI quota/error): {exc.__class__.__name__}",
        ) from exc

    await db.flush()
    await db.refresh(entry)
    return _to_response(entry)


# ---------------------------------------------------------------------------
# 5. GET /journal/weekly/wrapped  — "Spotify Wrapped" style week summary
# ---------------------------------------------------------------------------

@router.get("/weekly/wrapped", response_model=WeeklyWrapped)
async def weekly_wrapped(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WeeklyWrapped:
    today = date_type.today()
    week_start = today - timedelta(days=6)
    start_dt = datetime.combine(week_start, datetime.min.time(), tzinfo=timezone.utc)

    completed = (
        await db.execute(
            select(Task.title).where(
                and_(
                    Task.user_id == user.id,
                    Task.status == "done",
                    Task.updated_at >= start_dt,
                )
            )
        )
    ).scalars().all()

    habit_count = len(
        (
            await db.execute(
                select(HabitLog.id).where(
                    and_(HabitLog.user_id == user.id, HabitLog.period_date >= week_start)
                )
            )
        ).all()
    )

    meetings = (
        await db.execute(
            select(Meeting.title).where(
                and_(Meeting.user_id == user.id, Meeting.start_time >= start_dt)
            )
        )
    ).scalars().all()

    journals = (
        await db.execute(
            select(JournalEntry.content).where(
                and_(JournalEntry.user_id == user.id, JournalEntry.entry_date >= week_start)
            )
        )
    ).scalars().all()

    stats = [
        WrappedStat(label="Tasks completed", value=str(len(completed))),
        WrappedStat(label="Habit check-ins", value=str(habit_count)),
        WrappedStat(label="Meetings attended", value=str(len(meetings))),
        WrappedStat(label="Days journaled", value=str(len([j for j in journals if j]))),
    ]

    prompt = (
        f"Here is a person's week ({week_start} to {today}):\n"
        f"- Completed tasks ({len(completed)}): {', '.join(completed) or 'none'}\n"
        f"- Habit check-ins: {habit_count}\n"
        f"- Meetings ({len(meetings)}): {', '.join(meetings) or 'none'}\n"
        f"- Journal notes: {' | '.join(j for j in journals if j) or 'none'}\n\n"
        "Create a fun, punchy 'weekly wrapped' recap (like Spotify Wrapped). "
        "Return JSON: {\"headline\": short catchy title, \"summary\": 2-3 sentence "
        "recap, \"highlights\": [3 short bullet highlights]}."
    )

    try:
        import json
        completion = await openai_client.chat.completions.create(
            model=LLM_MODEL,
            response_format={"type": "json_object"},
            temperature=0.7,
            messages=[
                {"role": "system", "content": "You write upbeat weekly productivity recaps."},
                {"role": "user", "content": prompt},
            ],
        )
        data = json.loads(completion.choices[0].message.content or "{}")
        return WeeklyWrapped(
            headline=str(data.get("headline", "Your Week")),
            summary=str(data.get("summary", "")),
            stats=stats,
            highlights=[str(h) for h in data.get("highlights", [])],
        )
    except (RateLimitError, APIError):
        # Graceful fallback — still return the real stats without AI prose.
        return WeeklyWrapped(
            headline="Your Week in Review",
            summary=(
                f"You completed {len(completed)} tasks, checked in on habits "
                f"{habit_count} times, and attended {len(meetings)} meetings this week."
            ),
            stats=stats,
            highlights=[t for t in list(completed)[:3]] or ["Keep building momentum!"],
        )
