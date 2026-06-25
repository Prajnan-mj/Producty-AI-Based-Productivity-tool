from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.openai_client import openai_client, LLM_MODEL
from app.models import Bill, Meeting, SnoozeLog, Task, User
from app.security import get_current_user

router = APIRouter()


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class DeadlineSummary(BaseModel):
    overdue: int
    due_today: int
    due_this_week: int
    due_this_month: int
    upcoming: int


class TimelineItem(BaseModel):
    id: uuid.UUID
    type: str  # "task" | "meeting" | "bill"
    title: str
    deadline: datetime
    status: str
    urgency_level: str  # "overdue" | "critical" | "soon" | "normal"
    description: str | None = None


class SnoozeRequest(BaseModel):
    item_type: str = Field(..., pattern=r"^(task|bill)$")
    snooze_hours: int = Field(..., ge=1, le=720)


class SnoozeResponse(BaseModel):
    item_id: uuid.UUID
    item_type: str
    original_deadline: datetime
    new_deadline: datetime
    snooze_hours: int


class ScheduleBlock(BaseModel):
    task_id: uuid.UUID
    task_title: str
    recommended_start_date: str
    estimated_effort_hours: float
    blocking_tasks: list[str]
    suggested_schedule_blocks: list[str]
    reasoning: str


class RecommendationsResponse(BaseModel):
    recommendations: list[ScheduleBlock]
    analysis_date: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ensure_tz(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _urgency_level(deadline: datetime, now: datetime) -> str:
    dl = _ensure_tz(deadline)
    hours = (dl - now).total_seconds() / 3600
    if hours < 0:
        return "overdue"
    if hours <= 6:
        return "critical"
    if hours <= 48:
        return "soon"
    return "normal"


# ---------------------------------------------------------------------------
# 1. GET /deadlines/summary
# ---------------------------------------------------------------------------

@router.get("/summary", response_model=DeadlineSummary)
async def deadline_summary(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DeadlineSummary:
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = today_start + timedelta(days=1)
    week_end = today_start + timedelta(days=7)
    month_end = today_start + timedelta(days=30)

    # Gather all deadline datetimes from tasks, deadline-meetings, and bills.
    deadlines: list[datetime] = []

    # Tasks with deadlines (not done).
    result = await db.execute(
        select(Task.deadline).where(
            and_(
                Task.user_id == user.id,
                Task.deadline.isnot(None),
                Task.status != "done",
            )
        )
    )
    deadlines.extend(_ensure_tz(r[0]) for r in result.all())

    # Meetings flagged as deadlines.
    result = await db.execute(
        select(Meeting.end_time).where(
            and_(
                Meeting.user_id == user.id,
                Meeting.is_deadline.is_(True),
            )
        )
    )
    deadlines.extend(_ensure_tz(r[0]) for r in result.all())

    # Bills not yet paid.
    result = await db.execute(
        select(Bill.due_date).where(
            and_(
                Bill.user_id == user.id,
                Bill.status != "paid",
            )
        )
    )
    deadlines.extend(_ensure_tz(r[0]) for r in result.all())

    overdue = sum(1 for d in deadlines if d < now)
    due_today = sum(1 for d in deadlines if today_start <= d < today_end)
    due_this_week = sum(1 for d in deadlines if today_start <= d < week_end)
    due_this_month = sum(1 for d in deadlines if today_start <= d < month_end)
    upcoming = sum(1 for d in deadlines if d >= now)

    return DeadlineSummary(
        overdue=overdue,
        due_today=due_today,
        due_this_week=due_this_week,
        due_this_month=due_this_month,
        upcoming=upcoming,
    )


# ---------------------------------------------------------------------------
# 2. GET /deadlines/timeline
# ---------------------------------------------------------------------------

@router.get("/timeline", response_model=list[TimelineItem])
async def deadline_timeline(
    from_date: datetime = Query(..., description="ISO8601 start"),
    to_date: datetime = Query(..., description="ISO8601 end"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[TimelineItem]:
    now = datetime.now(timezone.utc)
    fr = _ensure_tz(from_date)
    to = _ensure_tz(to_date)

    if to <= fr:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="to_date must be after from_date",
        )

    items: list[TimelineItem] = []

    # Tasks with deadlines in range.
    result = await db.execute(
        select(Task).where(
            and_(
                Task.user_id == user.id,
                Task.deadline.isnot(None),
                Task.deadline >= fr,
                Task.deadline <= to,
            )
        )
    )
    for t in result.scalars().all():
        items.append(
            TimelineItem(
                id=t.id,
                type="task",
                title=t.title,
                deadline=_ensure_tz(t.deadline),  # type: ignore[arg-type]
                status=t.status,
                urgency_level=_urgency_level(t.deadline, now),  # type: ignore[arg-type]
                description=t.description,
            )
        )

    # Deadline meetings in range.
    result = await db.execute(
        select(Meeting).where(
            and_(
                Meeting.user_id == user.id,
                Meeting.is_deadline.is_(True),
                Meeting.end_time >= fr,
                Meeting.end_time <= to,
            )
        )
    )
    for m in result.scalars().all():
        items.append(
            TimelineItem(
                id=m.id,
                type="meeting",
                title=m.title,
                deadline=_ensure_tz(m.end_time),
                status="upcoming" if _ensure_tz(m.end_time) > now else "past",
                urgency_level=_urgency_level(m.end_time, now),
                description=m.description,
            )
        )

    # Bills in range.
    result = await db.execute(
        select(Bill).where(
            and_(
                Bill.user_id == user.id,
                Bill.due_date >= fr,
                Bill.due_date <= to,
            )
        )
    )
    for b in result.scalars().all():
        items.append(
            TimelineItem(
                id=b.id,
                type="bill",
                title=b.name,
                deadline=_ensure_tz(b.due_date),
                status=b.status,
                urgency_level=_urgency_level(b.due_date, now),
                description=b.notes,
            )
        )

    items.sort(key=lambda x: x.deadline)
    return items


# ---------------------------------------------------------------------------
# 3. POST /deadlines/snooze/{item_id}
# ---------------------------------------------------------------------------

@router.post("/snooze/{item_id}", response_model=SnoozeResponse)
async def snooze_deadline(
    item_id: uuid.UUID,
    body: SnoozeRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SnoozeResponse:
    delta = timedelta(hours=body.snooze_hours)

    if body.item_type == "task":
        result = await db.execute(
            select(Task).where(
                and_(Task.id == item_id, Task.user_id == user.id)
            )
        )
        item = result.scalar_one_or_none()
        if item is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
        if item.deadline is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Task has no deadline to snooze",
            )
        original = _ensure_tz(item.deadline)
        item.deadline = original + delta

    elif body.item_type == "bill":
        result = await db.execute(
            select(Bill).where(
                and_(Bill.id == item_id, Bill.user_id == user.id)
            )
        )
        item = result.scalar_one_or_none()
        if item is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bill not found")
        original = _ensure_tz(item.due_date)
        item.due_date = original + delta

    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="item_type must be 'task' or 'bill'",
        )

    new_deadline = original + delta

    log = SnoozeLog(
        user_id=user.id,
        item_id=item_id,
        item_type=body.item_type,
        snooze_hours=body.snooze_hours,
        original_deadline=original,
        new_deadline=new_deadline,
    )
    db.add(log)
    await db.flush()

    return SnoozeResponse(
        item_id=item_id,
        item_type=body.item_type,
        original_deadline=original,
        new_deadline=new_deadline,
        snooze_hours=body.snooze_hours,
    )


# ---------------------------------------------------------------------------
# 4. GET /deadlines/recommendations
# ---------------------------------------------------------------------------

_RECOMMEND_SYSTEM_PROMPT = (
    "You are a scheduling assistant. The user will give you a list of their "
    "upcoming deadlines (tasks and bills). For each one, suggest:\n"
    "- recommended_start_date: when they should begin working on it (ISO 8601 date)\n"
    "- estimated_effort_hours: realistic hours needed\n"
    "- blocking_tasks: list of other task titles that should be done first\n"
    "- suggested_schedule_blocks: e.g. ['Mon 9-11am', 'Wed 2-4pm']\n"
    "- reasoning: brief explanation\n\n"
    "Return strict JSON: {\"recommendations\": [{\"task_id\": ..., \"task_title\": ..., "
    "\"recommended_start_date\": ..., \"estimated_effort_hours\": ..., "
    "\"blocking_tasks\": [...], \"suggested_schedule_blocks\": [...], "
    "\"reasoning\": ...}]}"
)


@router.get("/recommendations", response_model=RecommendationsResponse)
async def deadline_recommendations(
    from_date: datetime | None = Query(
        default=None,
        description="Start date to view recommendations from (defaults to today)",
    ),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RecommendationsResponse:
    now = datetime.now(timezone.utc)
    start = _ensure_tz(from_date) if from_date else now
    window_end = start + timedelta(days=30)

    # Gather upcoming tasks.
    result = await db.execute(
        select(Task).where(
            and_(
                Task.user_id == user.id,
                Task.status != "done",
                Task.deadline.isnot(None),
                Task.deadline >= start,
                Task.deadline <= window_end,
            )
        ).order_by(Task.deadline.asc())
    )
    tasks = result.scalars().all()

    # Gather upcoming bills.
    result = await db.execute(
        select(Bill).where(
            and_(
                Bill.user_id == user.id,
                Bill.status != "paid",
                Bill.due_date >= start,
                Bill.due_date <= window_end,
            )
        ).order_by(Bill.due_date.asc())
    )
    bills = result.scalars().all()

    # Pull snooze history to inform the AI about user patterns.
    result = await db.execute(
        select(SnoozeLog).where(SnoozeLog.user_id == user.id)
        .order_by(SnoozeLog.created_at.desc())
        .limit(20)
    )
    snooze_history = result.scalars().all()

    if not tasks and not bills:
        return RecommendationsResponse(
            recommendations=[],
            analysis_date=now.date().isoformat(),
        )

    deadline_items: list[dict[str, Any]] = []
    for t in tasks:
        deadline_items.append({
            "task_id": str(t.id),
            "task_title": t.title,
            "type": "task",
            "deadline": t.deadline.isoformat() if t.deadline else None,
            "priority": t.priority,
            "description": t.description or "",
        })
    for b in bills:
        deadline_items.append({
            "task_id": str(b.id),
            "task_title": b.name,
            "type": "bill",
            "deadline": b.due_date.isoformat(),
            "priority": "high" if b.amount >= 500 else "medium",
            "description": b.notes or f"Amount: {b.currency} {b.amount:.2f}",
        })

    snooze_summary = ""
    if snooze_history:
        snooze_summary = (
            f"\n\nThe user has snoozed {len(snooze_history)} deadlines recently. "
            "They may procrastinate — recommend earlier start dates."
        )

    completion = await openai_client.chat.completions.create(
        model=LLM_MODEL,
        response_format={"type": "json_object"},
        temperature=0,
        messages=[
            {"role": "system", "content": _RECOMMEND_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    f"Today is {now.date().isoformat()}. "
                    f"Viewing from {start.date().isoformat()}.\n\n"
                    f"Upcoming deadlines:\n{json.dumps(deadline_items, indent=2)}"
                    f"{snooze_summary}"
                ),
            },
        ],
    )

    raw = completion.choices[0].message.content or "{}"
    try:
        data: dict[str, Any] = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"AI returned invalid JSON: {exc}",
        ) from exc

    raw_recs: list[dict[str, Any]] = data.get("recommendations", [])
    valid_ids: set[str] = {str(t.id) for t in tasks} | {str(b.id) for b in bills}

    recommendations: list[ScheduleBlock] = []
    for rec in raw_recs:
        tid = str(rec.get("task_id", ""))
        if tid not in valid_ids:
            continue
        recommendations.append(
            ScheduleBlock(
                task_id=uuid.UUID(tid),
                task_title=str(rec.get("task_title", "")),
                recommended_start_date=str(rec.get("recommended_start_date", "")),
                estimated_effort_hours=float(rec.get("estimated_effort_hours", 1.0)),
                blocking_tasks=[str(b) for b in rec.get("blocking_tasks", [])],
                suggested_schedule_blocks=[
                    str(s) for s in rec.get("suggested_schedule_blocks", [])
                ],
                reasoning=str(rec.get("reasoning", "")),
            )
        )

    return RecommendationsResponse(
        recommendations=recommendations,
        analysis_date=now.date().isoformat(),
    )
