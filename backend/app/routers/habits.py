from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Habit, HabitLog, User
from app.security import get_current_user

router = APIRouter()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class HabitCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=1024)
    description: str | None = None
    frequency: str = Field(default="daily", pattern=r"^(daily|weekly)$")
    target_count_per_period: int = Field(default=1, ge=1, le=50)
    category: str = Field(default="personal", pattern=r"^(health|learning|work|personal)$")
    color: str = Field(default="#6366f1", pattern=r"^#[0-9a-fA-F]{6}$")
    icon: str = Field(default="⭐", max_length=64)


class HabitResponse(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    frequency: str
    target_count_per_period: int
    category: str
    color: str
    icon: str
    is_active: bool
    completed_today: bool
    today_count: int
    current_streak: int
    created_at: datetime


class CompleteResponse(BaseModel):
    habit_id: uuid.UUID
    new_streak: int
    today_count: int
    completion_percentage: float


class DayCompletion(BaseModel):
    date: str
    count: int
    completed: bool


class HabitStats(BaseModel):
    streak: int
    longest_streak: int
    completion_rate: float
    completions_by_day: list[DayCompletion]
    total_completions: int
    period_summary: str


class TodaySummary(BaseModel):
    habits: list[HabitResponse]
    completed_count: int
    total_count: int
    completion_percentage: float


class DeleteResponse(BaseModel):
    detail: str


# ---------------------------------------------------------------------------
# Streak helpers
# ---------------------------------------------------------------------------

async def _get_completion_dates(
    habit_id: uuid.UUID, user_id: uuid.UUID, db: AsyncSession
) -> set[date]:
    """Return the set of dates on which the habit was completed."""
    result = await db.execute(
        select(HabitLog.period_date)
        .where(and_(HabitLog.habit_id == habit_id, HabitLog.user_id == user_id))
        .distinct()
    )
    return {row[0] for row in result.all()}


def _compute_streak(completion_dates: set[date], today: date) -> int:
    """Count consecutive days ending today or yesterday."""
    if not completion_dates:
        return 0
    # Allow today to be uncommitted — start from today if present, else yesterday.
    check = today if today in completion_dates else today - timedelta(days=1)
    if check not in completion_dates:
        return 0
    streak = 0
    while check in completion_dates:
        streak += 1
        check -= timedelta(days=1)
    return streak


def _compute_longest_streak(completion_dates: set[date]) -> int:
    if not completion_dates:
        return 0
    sorted_dates = sorted(completion_dates)
    longest = 1
    current = 1
    for i in range(1, len(sorted_dates)):
        if sorted_dates[i] - sorted_dates[i - 1] == timedelta(days=1):
            current += 1
            longest = max(longest, current)
        else:
            current = 1
    return longest


async def _today_count(
    habit_id: uuid.UUID, user_id: uuid.UUID, today: date, db: AsyncSession
) -> int:
    result = await db.execute(
        select(func.count())
        .select_from(HabitLog)
        .where(
            and_(
                HabitLog.habit_id == habit_id,
                HabitLog.user_id == user_id,
                HabitLog.period_date == today,
            )
        )
    )
    return result.scalar_one()


async def _habit_to_response(
    habit: Habit, user_id: uuid.UUID, today: date, db: AsyncSession
) -> HabitResponse:
    count = await _today_count(habit.id, user_id, today, db)
    dates = await _get_completion_dates(habit.id, user_id, db)
    streak = _compute_streak(dates, today)
    return HabitResponse(
        id=habit.id,
        name=habit.name,
        description=habit.description,
        frequency=habit.frequency,
        target_count_per_period=habit.target_count_per_period,
        category=habit.category,
        color=habit.color,
        icon=habit.icon,
        is_active=habit.is_active,
        completed_today=count >= habit.target_count_per_period,
        today_count=count,
        current_streak=streak,
        created_at=habit.created_at,
    )


async def _get_user_habit(
    habit_id: uuid.UUID, user: User, db: AsyncSession
) -> Habit:
    result = await db.execute(
        select(Habit).where(and_(Habit.id == habit_id, Habit.user_id == user.id))
    )
    habit = result.scalar_one_or_none()
    if habit is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Habit not found")
    return habit


# ---------------------------------------------------------------------------
# 1. GET /habits
# ---------------------------------------------------------------------------

@router.get("", response_model=list[HabitResponse])
async def list_habits(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[HabitResponse]:
    today = datetime.now(timezone.utc).date()
    result = await db.execute(
        select(Habit).where(
            and_(Habit.user_id == user.id, Habit.is_active.is_(True))
        ).order_by(Habit.created_at.asc())
    )
    habits = result.scalars().all()
    return [await _habit_to_response(h, user.id, today, db) for h in habits]


# ---------------------------------------------------------------------------
# 2. POST /habits
# ---------------------------------------------------------------------------

@router.post("", response_model=HabitResponse, status_code=status.HTTP_201_CREATED)
async def create_habit(
    body: HabitCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> HabitResponse:
    habit = Habit(
        user_id=user.id,
        name=body.name,
        description=body.description,
        frequency=body.frequency,
        target_count_per_period=body.target_count_per_period,
        category=body.category,
        color=body.color,
        icon=body.icon,
        is_active=True,
    )
    db.add(habit)
    await db.flush()
    await db.refresh(habit)
    today = datetime.now(timezone.utc).date()
    return await _habit_to_response(habit, user.id, today, db)


# ---------------------------------------------------------------------------
# 3. POST /habits/{habit_id}/complete
# ---------------------------------------------------------------------------

class CompleteRequest(BaseModel):
    notes: str | None = None


@router.post("/{habit_id}/complete", response_model=CompleteResponse)
async def complete_habit(
    habit_id: uuid.UUID,
    body: CompleteRequest = CompleteRequest(),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CompleteResponse:
    habit = await _get_user_habit(habit_id, user, db)
    today = datetime.now(timezone.utc).date()

    log = HabitLog(
        habit_id=habit.id,
        user_id=user.id,
        notes=body.notes,
        period_date=today,
    )
    db.add(log)
    await db.flush()

    count = await _today_count(habit.id, user.id, today, db)
    dates = await _get_completion_dates(habit.id, user.id, db)
    streak = _compute_streak(dates, today)
    pct = round(min(count / habit.target_count_per_period, 1.0) * 100, 1)

    return CompleteResponse(
        habit_id=habit.id,
        new_streak=streak,
        today_count=count,
        completion_percentage=pct,
    )


# ---------------------------------------------------------------------------
# 4. GET /habits/{habit_id}/stats
# ---------------------------------------------------------------------------

@router.get("/{habit_id}/stats", response_model=HabitStats)
async def habit_stats(
    habit_id: uuid.UUID,
    period: str = Query(default="month", pattern=r"^(week|month|all)$"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> HabitStats:
    habit = await _get_user_habit(habit_id, user, db)
    today = datetime.now(timezone.utc).date()

    if period == "week":
        start = today - timedelta(days=6)
    elif period == "month":
        start = today - timedelta(days=29)
    else:
        start = habit.created_at.date() if habit.created_at else today - timedelta(days=365)

    # All logs in the period.
    result = await db.execute(
        select(HabitLog.period_date, func.count())
        .where(
            and_(
                HabitLog.habit_id == habit.id,
                HabitLog.user_id == user.id,
                HabitLog.period_date >= start,
            )
        )
        .group_by(HabitLog.period_date)
    )
    counts_by_day: dict[date, int] = {row[0]: row[1] for row in result.all()}

    # Full date range for the calendar view.
    completions_by_day: list[DayCompletion] = []
    d = start
    while d <= today:
        c = counts_by_day.get(d, 0)
        completions_by_day.append(
            DayCompletion(
                date=d.isoformat(),
                count=c,
                completed=c >= habit.target_count_per_period,
            )
        )
        d += timedelta(days=1)

    all_dates = await _get_completion_dates(habit.id, user.id, db)
    streak = _compute_streak(all_dates, today)
    longest = _compute_longest_streak(all_dates)

    total_days_in_period = max((today - start).days + 1, 1)
    completed_days_in_period = sum(
        1 for dc in completions_by_day if dc.completed
    )
    rate = round(completed_days_in_period / total_days_in_period * 100, 1)

    total_completions_result = await db.execute(
        select(func.count())
        .select_from(HabitLog)
        .where(
            and_(HabitLog.habit_id == habit.id, HabitLog.user_id == user.id)
        )
    )
    total_completions = total_completions_result.scalar_one()

    return HabitStats(
        streak=streak,
        longest_streak=longest,
        completion_rate=rate,
        completions_by_day=completions_by_day,
        total_completions=total_completions,
        period_summary=(
            f"{completed_days_in_period}/{total_days_in_period} days completed "
            f"({rate}%) over the last {period}"
        ),
    )


# ---------------------------------------------------------------------------
# 5. GET /habits/summary/today
# ---------------------------------------------------------------------------

@router.get("/summary/today", response_model=TodaySummary)
async def today_summary(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TodaySummary:
    today = datetime.now(timezone.utc).date()
    result = await db.execute(
        select(Habit).where(
            and_(Habit.user_id == user.id, Habit.is_active.is_(True))
        )
    )
    habits = result.scalars().all()

    responses: list[HabitResponse] = []
    completed = 0
    for h in habits:
        resp = await _habit_to_response(h, user.id, today, db)
        responses.append(resp)
        if resp.completed_today:
            completed += 1

    total = len(responses)
    pct = round(completed / total * 100, 1) if total > 0 else 0.0

    return TodaySummary(
        habits=responses,
        completed_count=completed,
        total_count=total,
        completion_percentage=pct,
    )
