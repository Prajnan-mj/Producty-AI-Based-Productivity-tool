from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from celery import Celery
from celery.schedules import crontab
from sqlalchemy import select

from app.config import settings
from app.database import async_session_factory
from app.models import Bill, Habit, HabitLog, Task, User

logger = logging.getLogger("lastminute.workers")

celery_app = Celery(
    "lastminute",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    beat_schedule={
        "daily-plan-generation-7am": {
            "task": "app.workers.daily_plan_generation",
            "schedule": crontab(hour=7, minute=0),
        },
        "deadline-reminders-hourly": {
            "task": "app.workers.deadline_reminders",
            "schedule": crontab(minute=0),  # top of every hour
        },
        "gmail-sync-every-4h": {
            "task": "app.workers.gmail_sync",
            "schedule": crontab(minute=0, hour="*/4"),
        },
        "habit-streak-check-eod": {
            "task": "app.workers.habit_streak_check",
            "schedule": crontab(hour=23, minute=59),
        },
    },
)


# ---------------------------------------------------------------------------
# 1. Daily plan generation — every day at 7:00 AM UTC
# ---------------------------------------------------------------------------

async def _daily_plan_generation() -> dict[str, int]:
    from app.cache import safe_set
    from app.services import ai_service

    generated = 0
    async with async_session_factory() as db:
        users = (await db.execute(select(User))).scalars().all()
        today = datetime.now(timezone.utc).date().isoformat()
        for user in users:
            try:
                plan = await ai_service.generate_daily_plan(user.id, db)
                await safe_set(
                    f"daily_plan:{user.id}:{today}",
                    plan.model_dump_json(),
                    30 * 60,
                )
                generated += 1
            except Exception as exc:  # noqa: BLE001
                logger.warning("daily plan failed for %s: %s", user.id, exc)
    return {"users": generated}


@celery_app.task(name="app.workers.daily_plan_generation")
def daily_plan_generation() -> dict[str, int]:
    return asyncio.run(_daily_plan_generation())


# ---------------------------------------------------------------------------
# 2. Deadline reminders — every hour
# ---------------------------------------------------------------------------

async def _deadline_reminders() -> dict[str, int]:
    now = datetime.now(timezone.utc)
    window = now + timedelta(hours=24)
    reminded = 0

    async with async_session_factory() as db:
        tasks = (
            await db.execute(
                select(Task).where(
                    Task.status != "done",
                    Task.deadline.isnot(None),
                    Task.deadline >= now,
                    Task.deadline <= window,
                )
            )
        ).scalars().all()

        bills = (
            await db.execute(
                select(Bill).where(
                    Bill.status != "paid",
                    Bill.due_date >= now,
                    Bill.due_date <= window,
                )
            )
        ).scalars().all()

        for t in tasks:
            # Future: push notification / email. For now, log.
            logger.info("[REMINDER] Task '%s' due %s (user %s)", t.title, t.deadline, t.user_id)
            reminded += 1
        for b in bills:
            logger.info("[REMINDER] Bill '%s' (%s %s) due %s (user %s)",
                        b.name, b.currency, b.amount, b.due_date, b.user_id)
            reminded += 1

    return {"reminders": reminded}


@celery_app.task(name="app.workers.deadline_reminders")
def deadline_reminders() -> dict[str, int]:
    return asyncio.run(_deadline_reminders())


# ---------------------------------------------------------------------------
# 3. Gmail sync — every 4 hours
# ---------------------------------------------------------------------------

async def _gmail_sync() -> dict[str, int]:
    from app.services.google_service import extract_tasks_from_gmail

    total_new = 0
    async with async_session_factory() as db:
        users = (
            await db.execute(
                select(User).where(User.google_access_token.isnot(None))
            )
        ).scalars().all()

        for user in users:
            try:
                extracted = await extract_tasks_from_gmail(user, db, max_results=20)
                total_new += len(extracted)
            except Exception as exc:  # noqa: BLE001
                logger.warning("gmail sync failed for %s: %s", user.id, exc)
        await db.commit()

    return {"tasks_extracted": total_new}


@celery_app.task(name="app.workers.gmail_sync")
def gmail_sync() -> dict[str, int]:
    return asyncio.run(_gmail_sync())


# ---------------------------------------------------------------------------
# 4. Habit streak check — every day at 11:59 PM
# ---------------------------------------------------------------------------

async def _habit_streak_check() -> dict[str, int]:
    today = datetime.now(timezone.utc).date()
    missed = 0

    async with async_session_factory() as db:
        habits = (
            await db.execute(
                select(Habit).where(Habit.is_active.is_(True))
            )
        ).scalars().all()

        for habit in habits:
            if habit.frequency != "daily":
                continue
            logged = (
                await db.execute(
                    select(HabitLog.id).where(
                        HabitLog.habit_id == habit.id,
                        HabitLog.period_date == today,
                    )
                )
            ).first()
            if logged is None:
                logger.info("[STREAK] Habit '%s' missed today (user %s)", habit.name, habit.user_id)
                missed += 1

    return {"missed": missed}


@celery_app.task(name="app.workers.habit_streak_check")
def habit_streak_check() -> dict[str, int]:
    return asyncio.run(_habit_streak_check())
