"""Infrastructure endpoints — zero AI dependency, pure deterministic logic.

Feature A1: Recurring task engine (RRULE materialization)
Feature A3: Bill due-date math + flagging
Feature A4: Habit streak + completion engine
Feature A5: Search across tasks/notes
Feature A6: Notification scheduling
"""
from __future__ import annotations

import uuid
from datetime import date as date_type, datetime, timedelta, timezone
from typing import Any

from dateutil.rrule import rrule, DAILY, WEEKLY, MONTHLY, YEARLY
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import (
    Bill, Habit, HabitLog, Meeting, Note, ScheduledReminder, Task, User,
)
from app.security import get_current_user

router = APIRouter()

_FREQ_MAP = {"daily": DAILY, "weekly": WEEKLY, "monthly": MONTHLY, "yearly": YEARLY}


# ═══════════════════════════════════════════════════════════════════
# A1: Recurring Task Engine
# ═══════════════════════════════════════════════════════════════════

class RecurrenceSet(BaseModel):
    rule: str = Field("none", pattern=r"^(none|daily|weekly|monthly|yearly)$")
    interval: int = Field(1, ge=1, le=365)


class MaterializeResponse(BaseModel):
    created: int
    next_dates: list[str]


@router.patch("/tasks/{task_id}/recurrence")
async def set_task_recurrence(
    task_id: uuid.UUID,
    body: RecurrenceSet,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    task = (
        await db.execute(select(Task).where(and_(Task.id == task_id, Task.user_id == user.id)))
    ).scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    task.recurrence_rule = body.rule
    task.recurrence_interval = body.interval
    await db.flush()
    return {"detail": f"Recurrence set to {body.rule} every {body.interval}"}


@router.post("/tasks/{task_id}/materialize", response_model=MaterializeResponse)
async def materialize_recurrence(
    task_id: uuid.UUID,
    count: int = Query(default=5, ge=1, le=52),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MaterializeResponse:
    """Pre-generate the next N occurrences of a recurring task."""
    task = (
        await db.execute(select(Task).where(and_(Task.id == task_id, Task.user_id == user.id)))
    ).scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.recurrence_rule == "none":
        raise HTTPException(status_code=400, detail="Task has no recurrence rule")
    if task.deadline is None:
        raise HTTPException(status_code=400, detail="Task needs a deadline as the recurrence anchor")

    freq = _FREQ_MAP.get(task.recurrence_rule)
    if freq is None:
        raise HTTPException(status_code=400, detail="Invalid recurrence rule")

    anchor = task.deadline if task.deadline.tzinfo else task.deadline.replace(tzinfo=timezone.utc)
    dates = list(rrule(
        freq=freq, interval=task.recurrence_interval,
        dtstart=anchor + timedelta(days=1),
        count=count,
    ))

    created = 0
    next_dates: list[str] = []
    for dt in dates:
        dt_aware = dt.replace(tzinfo=timezone.utc)
        sub = Task(
            user_id=user.id, title=task.title, description=task.description,
            deadline=dt_aware, priority=task.priority, status="pending",
            source="recurrence", recurrence_rule="none",
            parent_task_id=task.id, tags=task.tags,
        )
        db.add(sub)
        created += 1
        next_dates.append(dt_aware.isoformat())

    await db.flush()
    return MaterializeResponse(created=created, next_dates=next_dates)


# ═══════════════════════════════════════════════════════════════════
# A3: Bill Due-Date Math + Flagging
# ═══════════════════════════════════════════════════════════════════

class BillAlert(BaseModel):
    id: uuid.UUID
    name: str
    amount: float
    currency: str
    due_date: datetime
    days_until_due: int
    is_overdue: bool
    is_due_soon: bool
    status: str


@router.get("/bills/due-check", response_model=list[BillAlert])
async def bill_due_check(
    threshold_days: int = Query(default=7, ge=1, le=90),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[BillAlert]:
    now = datetime.now(timezone.utc)
    bills = (
        await db.execute(
            select(Bill).where(
                and_(Bill.user_id == user.id, Bill.status != "paid")
            ).order_by(Bill.due_date.asc())
        )
    ).scalars().all()

    alerts: list[BillAlert] = []
    for b in bills:
        due = b.due_date if b.due_date.tzinfo else b.due_date.replace(tzinfo=timezone.utc)
        days = (due - now).days
        alerts.append(BillAlert(
            id=b.id, name=b.name, amount=float(b.amount), currency=b.currency,
            due_date=b.due_date, days_until_due=days,
            is_overdue=days < 0,
            is_due_soon=0 <= days <= threshold_days,
            status=b.status,
        ))

    return alerts


@router.post("/bills/{bill_id}/materialize-recurrence")
async def materialize_bill_recurrence(
    bill_id: uuid.UUID,
    count: int = Query(default=6, ge=1, le=24),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    bill = (
        await db.execute(select(Bill).where(and_(Bill.id == bill_id, Bill.user_id == user.id)))
    ).scalar_one_or_none()
    if bill is None:
        raise HTTPException(status_code=404, detail="Bill not found")
    if bill.recurrence == "one-time":
        raise HTTPException(status_code=400, detail="Bill is one-time, no recurrence to materialize")

    freq = _FREQ_MAP.get(bill.recurrence)
    if freq is None:
        raise HTTPException(status_code=400, detail="Unknown recurrence type")

    anchor = bill.due_date if bill.due_date.tzinfo else bill.due_date.replace(tzinfo=timezone.utc)
    dates = list(rrule(freq=freq, dtstart=anchor + timedelta(days=1), count=count))

    created = 0
    for dt in dates:
        dt_aware = dt.replace(tzinfo=timezone.utc)
        new_bill = Bill(
            user_id=user.id, name=bill.name, amount=bill.amount, currency=bill.currency,
            due_date=dt_aware, recurrence="one-time", category=bill.category,
            platform=bill.platform, status="pending", autopay_enabled=bill.autopay_enabled,
        )
        db.add(new_bill)
        created += 1
    await db.flush()
    return {"detail": f"Created {created} future bill instances"}


# ═══════════════════════════════════════════════════════════════════
# A4: Habit Streak + Completion Engine
# ═══════════════════════════════════════════════════════════════════

class HabitStats(BaseModel):
    habit_id: uuid.UUID
    habit_name: str
    current_streak: int
    longest_streak: int
    completion_rate_7d: float
    completion_rate_30d: float
    total_completions: int
    last_completed: datetime | None


@router.get("/habits/{habit_id}/streaks", response_model=HabitStats)
async def habit_streaks(
    habit_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> HabitStats:
    habit = (
        await db.execute(select(Habit).where(and_(Habit.id == habit_id, Habit.user_id == user.id)))
    ).scalar_one_or_none()
    if habit is None:
        raise HTTPException(status_code=404, detail="Habit not found")

    logs = (
        await db.execute(
            select(HabitLog.period_date).where(HabitLog.habit_id == habit_id)
            .order_by(HabitLog.period_date.desc())
        )
    ).scalars().all()

    if not logs:
        return HabitStats(
            habit_id=habit.id, habit_name=habit.name,
            current_streak=0, longest_streak=0,
            completion_rate_7d=0, completion_rate_30d=0,
            total_completions=0, last_completed=None,
        )

    dates = sorted(set(logs))
    today = date_type.today()

    # Current streak: consecutive days ending today or yesterday
    current = 0
    check = today
    date_set = set(dates)
    if check not in date_set:
        check = today - timedelta(days=1)
    while check in date_set:
        current += 1
        check -= timedelta(days=1)

    # Longest streak
    longest = 0
    streak = 1
    for i in range(1, len(dates)):
        if (dates[i] - dates[i - 1]).days == 1:
            streak += 1
        else:
            longest = max(longest, streak)
            streak = 1
    longest = max(longest, streak)

    # Completion rates
    d7 = today - timedelta(days=7)
    d30 = today - timedelta(days=30)
    in_7 = sum(1 for d in dates if d >= d7)
    in_30 = sum(1 for d in dates if d >= d30)

    last = (
        await db.execute(
            select(HabitLog.completed_at).where(HabitLog.habit_id == habit_id)
            .order_by(HabitLog.completed_at.desc()).limit(1)
        )
    ).scalar_one_or_none()

    return HabitStats(
        habit_id=habit.id, habit_name=habit.name,
        current_streak=current, longest_streak=longest,
        completion_rate_7d=round(in_7 / 7 * 100, 1),
        completion_rate_30d=round(in_30 / 30 * 100, 1),
        total_completions=len(dates),
        last_completed=last,
    )


# ═══════════════════════════════════════════════════════════════════
# A5: Full-Text Search
# ═══════════════════════════════════════════════════════════════════

class SearchResult(BaseModel):
    id: uuid.UUID
    type: str  # "task" | "note" | "bill" | "meeting"
    title: str
    snippet: str | None = None
    deadline: datetime | None = None
    tags: str | None = None


@router.get("/search", response_model=list[SearchResult])
async def search_everything(
    q: str = Query(..., min_length=1, max_length=200),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[SearchResult]:
    """Full-text search across tasks, notes, bills, and meetings using ILIKE."""
    pattern = f"%{q}%"
    results: list[SearchResult] = []

    # Tasks
    tasks = (
        await db.execute(
            select(Task).where(
                and_(Task.user_id == user.id, or_(
                    Task.title.ilike(pattern),
                    Task.description.ilike(pattern),
                    Task.tags.ilike(pattern),
                ))
            ).limit(15)
        )
    ).scalars().all()
    for t in tasks:
        results.append(SearchResult(
            id=t.id, type="task", title=t.title,
            snippet=(t.description or "")[:120],
            deadline=t.deadline, tags=t.tags,
        ))

    # Notes
    notes = (
        await db.execute(
            select(Note).where(
                and_(Note.user_id == user.id, or_(
                    Note.title.ilike(pattern),
                    Note.content.ilike(pattern),
                ))
            ).limit(10)
        )
    ).scalars().all()
    for n in notes:
        results.append(SearchResult(
            id=n.id, type="note", title=n.title,
            snippet=(n.content or "")[:120],
        ))

    # Bills
    bills = (
        await db.execute(
            select(Bill).where(
                and_(Bill.user_id == user.id, Bill.name.ilike(pattern))
            ).limit(5)
        )
    ).scalars().all()
    for b in bills:
        results.append(SearchResult(
            id=b.id, type="bill", title=b.name,
            snippet=f"{b.currency} {float(b.amount):.0f} — {b.status}",
            deadline=b.due_date,
        ))

    # Meetings
    meetings = (
        await db.execute(
            select(Meeting).where(
                and_(Meeting.user_id == user.id, or_(
                    Meeting.title.ilike(pattern),
                    Meeting.description.ilike(pattern),
                ))
            ).limit(5)
        )
    ).scalars().all()
    for m in meetings:
        results.append(SearchResult(
            id=m.id, type="meeting", title=m.title,
            snippet=m.category,
            deadline=m.start_time,
        ))

    return results


# ═══════════════════════════════════════════════════════════════════
# A5 (cont.): Tag operations
# ═══════════════════════════════════════════════════════════════════

class TagUpdate(BaseModel):
    tags: str = Field(..., max_length=500)


@router.patch("/tasks/{task_id}/tags")
async def update_tags(
    task_id: uuid.UUID,
    body: TagUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    task = (
        await db.execute(select(Task).where(and_(Task.id == task_id, Task.user_id == user.id)))
    ).scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    task.tags = body.tags
    await db.flush()
    return {"detail": "Tags updated"}


@router.get("/tags", response_model=list[str])
async def list_all_tags(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[str]:
    rows = (
        await db.execute(
            select(Task.tags).where(
                and_(Task.user_id == user.id, Task.tags.isnot(None), Task.tags != "")
            )
        )
    ).scalars().all()
    all_tags: set[str] = set()
    for raw in rows:
        for tag in raw.split(","):
            t = tag.strip()
            if t:
                all_tags.add(t)
    return sorted(all_tags)


# ═══════════════════════════════════════════════════════════════════
# A6: Notification Scheduling Infrastructure
# ═══════════════════════════════════════════════════════════════════

class ScheduleReminder(BaseModel):
    item_id: uuid.UUID
    item_type: str = Field("task", pattern=r"^(task|bill|meeting|habit)$")
    fire_at: datetime
    payload: dict[str, Any] | None = None


class ReminderOut(BaseModel):
    id: uuid.UUID
    item_id: uuid.UUID
    item_type: str
    fire_at: datetime
    status: str
    suppression_count: int


@router.post("/reminders", response_model=ReminderOut)
async def schedule_reminder(
    body: ScheduleReminder,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ReminderOut:
    r = ScheduledReminder(
        user_id=user.id, item_id=body.item_id, item_type=body.item_type,
        fire_at=body.fire_at, payload=body.payload,
    )
    db.add(r)
    await db.flush()
    await db.refresh(r)
    return ReminderOut(
        id=r.id, item_id=r.item_id, item_type=r.item_type,
        fire_at=r.fire_at, status=r.status, suppression_count=r.suppression_count,
    )


@router.get("/reminders/pending", response_model=list[ReminderOut])
async def pending_reminders(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ReminderOut]:
    now = datetime.now(timezone.utc)
    rows = (
        await db.execute(
            select(ScheduledReminder).where(
                and_(
                    ScheduledReminder.user_id == user.id,
                    ScheduledReminder.status == "pending",
                    ScheduledReminder.fire_at <= now + timedelta(hours=24),
                )
            ).order_by(ScheduledReminder.fire_at.asc())
        )
    ).scalars().all()
    return [ReminderOut(
        id=r.id, item_id=r.item_id, item_type=r.item_type,
        fire_at=r.fire_at, status=r.status, suppression_count=r.suppression_count,
    ) for r in rows]


@router.post("/reminders/{reminder_id}/fire")
async def fire_reminder(
    reminder_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Fire (or suppress) a reminder — checks active calendar blocks first."""
    r = (
        await db.execute(
            select(ScheduledReminder).where(
                and_(ScheduledReminder.id == reminder_id, ScheduledReminder.user_id == user.id)
            )
        )
    ).scalar_one_or_none()
    if r is None:
        raise HTTPException(status_code=404, detail="Reminder not found")

    now = datetime.now(timezone.utc)

    # Check for active meeting/focus block (Feature A6 + earlier Feature 6)
    active = (
        await db.execute(
            select(Meeting).where(
                and_(Meeting.user_id == user.id, Meeting.start_time <= now, Meeting.end_time >= now)
            )
        )
    ).scalar_one_or_none()

    if active:
        r.suppression_count += 1
        next_free = active.end_time
        if next_free.tzinfo is None:
            next_free = next_free.replace(tzinfo=timezone.utc)
        r.fire_at = next_free + timedelta(minutes=5)

        # Escalation: if suppressed 2+ times, mark for escalated channel
        channel = "push" if r.suppression_count < 2 else "escalated"
        await db.flush()
        return {
            "fired": False,
            "suppressed": True,
            "reason": f"You're in '{active.title}' — rescheduled to {r.fire_at.strftime('%H:%M')}",
            "next_fire_at": r.fire_at.isoformat(),
            "channel": channel,
            "suppression_count": r.suppression_count,
        }

    r.status = "fired"
    await db.flush()
    return {
        "fired": True,
        "suppressed": False,
        "item_id": str(r.item_id),
        "item_type": r.item_type,
        "payload": r.payload,
    }
