"""Admin-only analytics. Every route is gated by `require_admin`, so only
emails in settings.ADMIN_EMAILS can reach them. Never exposes OAuth tokens."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Task, User, UserActivity
from app.security import require_admin

router = APIRouter()


# ---------------------------------------------------------------------------
# Overview — headline numbers
# ---------------------------------------------------------------------------

class Overview(BaseModel):
    total_users: int
    new_today: int
    new_7d: int
    new_30d: int
    active_today: int
    active_7d: int
    active_30d: int


@router.get("/stats/overview", response_model=Overview)
async def overview(
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> Overview:
    now = datetime.now(timezone.utc)
    today = now.date()
    d7 = today - timedelta(days=6)    # inclusive 7-day window
    d30 = today - timedelta(days=29)  # inclusive 30-day window

    async def count_users_since(since_dt: datetime) -> int:
        return int(
            await db.scalar(
                select(func.count(User.id)).where(User.created_at >= since_dt)
            ) or 0
        )

    async def count_active_since(since_day) -> int:
        return int(
            await db.scalar(
                select(func.count(func.distinct(UserActivity.user_id)))
                .where(UserActivity.day >= since_day)
            ) or 0
        )

    start_today = datetime(today.year, today.month, today.day, tzinfo=timezone.utc)

    return Overview(
        total_users=int(await db.scalar(select(func.count(User.id))) or 0),
        new_today=await count_users_since(start_today),
        new_7d=await count_users_since(datetime.combine(d7, datetime.min.time(), tzinfo=timezone.utc)),
        new_30d=await count_users_since(datetime.combine(d30, datetime.min.time(), tzinfo=timezone.utc)),
        active_today=await count_active_since(today),
        active_7d=await count_active_since(d7),
        active_30d=await count_active_since(d30),
    )


# ---------------------------------------------------------------------------
# Daily series — registrations + active users per day
# ---------------------------------------------------------------------------

class DayPoint(BaseModel):
    date: str
    registered: int
    active: int


@router.get("/stats/daily", response_model=list[DayPoint])
async def daily(
    days: int = Query(30, ge=1, le=180),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> list[DayPoint]:
    today = datetime.now(timezone.utc).date()
    start = today - timedelta(days=days - 1)

    # Registrations grouped by calendar day.
    reg_rows = (
        await db.execute(
            select(func.date(User.created_at), func.count(User.id))
            .where(User.created_at >= datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc))
            .group_by(func.date(User.created_at))
        )
    ).all()
    reg_by_day = {str(r[0]): int(r[1]) for r in reg_rows}

    # Active users grouped by day.
    act_rows = (
        await db.execute(
            select(UserActivity.day, func.count(func.distinct(UserActivity.user_id)))
            .where(UserActivity.day >= start)
            .group_by(UserActivity.day)
        )
    ).all()
    act_by_day = {str(r[0]): int(r[1]) for r in act_rows}

    series: list[DayPoint] = []
    for i in range(days):
        d = str(start + timedelta(days=i))
        series.append(DayPoint(date=d, registered=reg_by_day.get(d, 0), active=act_by_day.get(d, 0)))
    return series


# ---------------------------------------------------------------------------
# User list — paginated. Emails + activity only. No tokens, ever.
# ---------------------------------------------------------------------------

class AdminUser(BaseModel):
    id: str
    email: str
    name: str | None
    picture_url: str | None
    created_at: str
    last_login_at: str | None
    days_active: int
    task_count: int


class UserPage(BaseModel):
    total: int
    users: list[AdminUser]


@router.get("/users", response_model=UserPage)
async def list_users(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> UserPage:
    total = int(await db.scalar(select(func.count(User.id))) or 0)

    rows = (
        await db.execute(
            select(User).order_by(User.created_at.desc()).limit(limit).offset(offset)
        )
    ).scalars().all()

    # Per-user counts in two grouped queries (avoids N+1).
    ids = [u.id for u in rows]
    days_active: dict = {}
    task_counts: dict = {}
    if ids:
        for uid, cnt in (
            await db.execute(
                select(UserActivity.user_id, func.count(UserActivity.id))
                .where(UserActivity.user_id.in_(ids))
                .group_by(UserActivity.user_id)
            )
        ).all():
            days_active[uid] = int(cnt)
        for uid, cnt in (
            await db.execute(
                select(Task.user_id, func.count(Task.id))
                .where(Task.user_id.in_(ids))
                .group_by(Task.user_id)
            )
        ).all():
            task_counts[uid] = int(cnt)

    users = [
        AdminUser(
            id=str(u.id),
            email=u.email,
            name=u.name,
            picture_url=u.picture_url,
            created_at=u.created_at.isoformat(),
            last_login_at=u.last_login_at.isoformat() if u.last_login_at else None,
            days_active=days_active.get(u.id, 0),
            task_count=task_counts.get(u.id, 0),
        )
        for u in rows
    ]
    return UserPage(total=total, users=users)


# ---------------------------------------------------------------------------
# Whoami — lets the frontend know if the signed-in user is an admin
# ---------------------------------------------------------------------------

@router.get("/whoami")
async def whoami(user: User = Depends(require_admin)) -> dict[str, object]:
    return {"is_admin": True, "email": user.email}
