from __future__ import annotations

from datetime import date as date_type

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import MoodCheckin, Task, User
from app.security import get_current_user

router = APIRouter()

PRI_RANK = {"high": 3, "medium": 2, "low": 1}


class MoodSubmit(BaseModel):
    energy: int = Field(..., ge=1, le=5)


class MoodResponse(BaseModel):
    energy: int | None
    message: str
    focus: list[str]


def _message_for(energy: int) -> str:
    if energy <= 2:
        return "Low battery today. Start with quick wins to build momentum — the hard stuff can wait."
    if energy >= 4:
        return "You're charged up. Hit the hardest, highest-impact task first while you've got the fuel."
    return "Steady day. Alternate one hard task with an easy one to keep moving."


async def _ordered_tasks(user: User, energy: int, db: AsyncSession) -> list[str]:
    tasks = (
        await db.execute(
            select(Task).where(and_(Task.user_id == user.id, Task.status != "done"))
        )
    ).scalars().all()
    if not tasks:
        return []
    hard_first = energy >= 4
    tasks_sorted = sorted(
        tasks,
        key=lambda t: PRI_RANK.get(t.priority, 2),
        reverse=hard_first,
    )
    return [t.title for t in tasks_sorted[:5]]


@router.get("/today", response_model=MoodResponse)
async def mood_today(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MoodResponse:
    today = date_type.today()
    checkin = (
        await db.execute(
            select(MoodCheckin).where(
                and_(MoodCheckin.user_id == user.id, MoodCheckin.checkin_date == today)
            )
        )
    ).scalar_one_or_none()
    if checkin is None:
        return MoodResponse(energy=None, message="How's your energy today?", focus=[])
    return MoodResponse(
        energy=checkin.energy,
        message=_message_for(checkin.energy),
        focus=await _ordered_tasks(user, checkin.energy, db),
    )


@router.post("", response_model=MoodResponse)
async def submit_mood(
    body: MoodSubmit,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MoodResponse:
    today = date_type.today()
    checkin = (
        await db.execute(
            select(MoodCheckin).where(
                and_(MoodCheckin.user_id == user.id, MoodCheckin.checkin_date == today)
            )
        )
    ).scalar_one_or_none()
    if checkin is None:
        checkin = MoodCheckin(user_id=user.id, checkin_date=today, energy=body.energy)
        db.add(checkin)
    else:
        checkin.energy = body.energy
    await db.flush()

    return MoodResponse(
        energy=body.energy,
        message=_message_for(body.energy),
        focus=await _ordered_tasks(user, body.energy, db),
    )
