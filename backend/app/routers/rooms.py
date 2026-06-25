from __future__ import annotations

import secrets
import string
import uuid

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.llm import genai_generate
from app.models import Room, RoomMember, Task, User
from app.security import get_current_user

router = APIRouter()


class RoomCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)


class JoinRequest(BaseModel):
    code: str = Field(..., min_length=4, max_length=16)


class MemberStat(BaseModel):
    user_id: uuid.UUID
    name: str
    completion_rate: int
    done: int
    total: int
    is_you: bool


class RoomResponse(BaseModel):
    id: uuid.UUID
    name: str
    code: str
    is_owner: bool
    members: list[MemberStat]


def _gen_code() -> str:
    return "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(6))


async def _member_stats(room_id: uuid.UUID, current_user_id: uuid.UUID, db: AsyncSession) -> list[MemberStat]:
    rows = (
        await db.execute(
            select(User.id, User.name, User.email)
            .join(RoomMember, RoomMember.user_id == User.id)
            .where(RoomMember.room_id == room_id)
        )
    ).all()

    stats: list[MemberStat] = []
    for uid, name, email in rows:
        total = (
            await db.execute(select(func.count(Task.id)).where(Task.user_id == uid))
        ).scalar() or 0
        done = (
            await db.execute(select(func.count(Task.id)).where(and_(Task.user_id == uid, Task.status == "done")))
        ).scalar() or 0
        rate = round(done / total * 100) if total else 0
        stats.append(MemberStat(
            user_id=uid, name=name or (email.split("@")[0] if email else "Member"),
            completion_rate=rate, done=done, total=total, is_you=(uid == current_user_id),
        ))
    stats.sort(key=lambda s: s.completion_rate, reverse=True)
    return stats


async def _room_response(room: Room, user: User, db: AsyncSession) -> RoomResponse:
    return RoomResponse(
        id=room.id, name=room.name, code=room.code,
        is_owner=(room.owner_id == user.id),
        members=await _member_stats(room.id, user.id, db),
    )


@router.get("", response_model=list[RoomResponse])
async def list_rooms(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[RoomResponse]:
    room_ids = (
        await db.execute(select(RoomMember.room_id).where(RoomMember.user_id == user.id))
    ).scalars().all()
    if not room_ids:
        return []
    rooms = (
        await db.execute(select(Room).where(Room.id.in_(list(room_ids))).order_by(Room.created_at.desc()))
    ).scalars().all()
    return [await _room_response(r, user, db) for r in rooms]


@router.post("", response_model=RoomResponse)
async def create_room(
    body: RoomCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RoomResponse:
    # Ensure a unique code.
    code = _gen_code()
    while (await db.execute(select(Room).where(Room.code == code))).scalar_one_or_none() is not None:
        code = _gen_code()

    room = Room(name=body.name, code=code, owner_id=user.id)
    db.add(room)
    await db.flush()
    db.add(RoomMember(room_id=room.id, user_id=user.id))
    await db.flush()
    await db.refresh(room)
    return await _room_response(room, user, db)


@router.post("/join", response_model=RoomResponse)
async def join_room(
    body: JoinRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RoomResponse:
    room = (
        await db.execute(select(Room).where(Room.code == body.code.upper()))
    ).scalar_one_or_none()
    if room is None:
        raise HTTPException(status_code=404, detail="No room with that code")

    existing = (
        await db.execute(
            select(RoomMember).where(and_(RoomMember.room_id == room.id, RoomMember.user_id == user.id))
        )
    ).scalar_one_or_none()
    if existing is None:
        db.add(RoomMember(room_id=room.id, user_id=user.id))
        await db.flush()
    return await _room_response(room, user, db)


@router.post("/{room_id}/leave")
async def leave_room(
    room_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    member = (
        await db.execute(
            select(RoomMember).where(and_(RoomMember.room_id == room_id, RoomMember.user_id == user.id))
        )
    ).scalar_one_or_none()
    if member is not None:
        await db.delete(member)
        await db.flush()
    return {"detail": "left"}


# ---------------------------------------------------------------------------
# Feature 7: Group Project Coordinator
# ---------------------------------------------------------------------------

class CoordinateRequest(BaseModel):
    deliverable: str = Field(..., min_length=1, max_length=1024)
    deadline: str  # ISO 8601
    estimated_hours: float = Field(8, gt=0, le=200)


class MemberAssignment(BaseModel):
    user_id: uuid.UUID
    name: str
    assigned_subtask: str
    estimated_hours: float
    load_ratio: float  # relative to average


class CoordinateResponse(BaseModel):
    deliverable: str
    deadline: str
    feasible: bool
    warning: str | None = None
    assignments: list[MemberAssignment]


_COORD_SYSTEM = (
    "Given N group members with these current task loads, propose a fair "
    "sub-task split for a group deliverable, weighted so no one member exceeds "
    "1.5x the average load. Flag if the deadline is unrealistic.\n\n"
    'Return JSON: {"feasible": true/false, "warning": "..." or null, '
    '"assignments": [{"user_id": "...", "name": "...", "subtask": "...", '
    '"hours": N}]}'
)


@router.post("/{room_id}/coordinate", response_model=CoordinateResponse)
async def coordinate_project(
    room_id: uuid.UUID,
    body: CoordinateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CoordinateResponse:
    # Verify membership
    is_member = (
        await db.execute(
            select(RoomMember).where(
                and_(RoomMember.room_id == room_id, RoomMember.user_id == user.id)
            )
        )
    ).scalar_one_or_none()
    if is_member is None:
        raise HTTPException(status_code=403, detail="You're not a member of this room")

    # Get all members + their current workload
    members = (
        await db.execute(
            select(User.id, User.name, User.email)
            .join(RoomMember, RoomMember.user_id == User.id)
            .where(RoomMember.room_id == room_id)
        )
    ).all()

    member_data = []
    for uid, name, email in members:
        pending = (
            await db.execute(
                select(func.count(Task.id)).where(
                    and_(Task.user_id == uid, Task.status != "done")
                )
            )
        ).scalar() or 0
        member_data.append({
            "user_id": str(uid),
            "name": name or (email.split("@")[0] if email else "Member"),
            "current_pending_tasks": pending,
        })

    prompt = (
        f"Deliverable: {body.deliverable}\n"
        f"Deadline: {body.deadline}\n"
        f"Estimated total hours: {body.estimated_hours}\n"
        f"Now: {datetime.now(timezone.utc).isoformat()}\n\n"
        f"Members:\n{json.dumps(member_data, indent=2)}"
    )

    try:
        raw = await genai_generate(_COORD_SYSTEM, prompt, temperature=0.3)
        data = json.loads(raw)
    except Exception:
        # Fallback: even split
        per_person = body.estimated_hours / max(len(members), 1)
        data = {
            "feasible": True,
            "warning": None,
            "assignments": [
                {"user_id": str(uid), "name": n or "", "subtask": f"Part of: {body.deliverable}", "hours": round(per_person, 1)}
                for uid, n, _ in members
            ],
        }

    assignments = []
    avg_hours = body.estimated_hours / max(len(members), 1)
    for a in data.get("assignments", []):
        hours = float(a.get("hours", avg_hours))
        assignments.append(MemberAssignment(
            user_id=uuid.UUID(str(a.get("user_id", members[0][0] if members else uuid.uuid4()))),
            name=str(a.get("name", "")),
            assigned_subtask=str(a.get("subtask", "")),
            estimated_hours=round(hours, 1),
            load_ratio=round(hours / max(avg_hours, 0.1), 2),
        ))

    return CoordinateResponse(
        deliverable=body.deliverable,
        deadline=body.deadline,
        feasible=bool(data.get("feasible", True)),
        warning=data.get("warning"),
        assignments=assignments,
    )
