from __future__ import annotations

import json
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from openai import APIError, RateLimitError
from pydantic import BaseModel
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Bill, Meeting, PanicPlan, Task, User
from app.openai_client import openai_client, LLM_MODEL
from app.security import get_current_user

router = APIRouter()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class TriageItem(BaseModel):
    item: str
    verdict: str  # "do" | "defer" | "drop"
    why: str


class ScheduleBlock(BaseModel):
    time: str
    action: str
    minutes: int | None = None


class PanicPlanResponse(BaseModel):
    id: uuid.UUID
    share_token: str
    headline: str
    triage: list[TriageItem]
    schedule: list[ScheduleBlock]
    pep_talk: str
    item_count: int
    created_at: datetime


_SYSTEM = (
    "You are an emergency triage coach for someone in crisis with too much due soon. "
    "Given everything due in the next 48 hours, decide what to DO, what to DEFER, and "
    "what to DROP (be ruthless — survival, not perfection). Then build a realistic "
    "minute-by-minute-ish survival schedule across the available hours. "
    "Return strict JSON: {\"headline\": short punchy line, \"triage\": [{\"item\": str, "
    "\"verdict\": \"do\"|\"defer\"|\"drop\", \"why\": short reason}], \"schedule\": "
    "[{\"time\": \"e.g. 9:00 AM\", \"action\": str, \"minutes\": int}], "
    "\"pep_talk\": one encouraging sentence}."
)


async def _gather_48h(user: User, db: AsyncSession) -> tuple[list[str], list[dict[str, Any]]]:
    now = datetime.now(timezone.utc)
    horizon = now + timedelta(hours=48)
    lines: list[str] = []
    raw: list[dict[str, Any]] = []

    tasks = (
        await db.execute(
            select(Task).where(
                and_(
                    Task.user_id == user.id,
                    Task.status != "done",
                    Task.deadline.isnot(None),
                    Task.deadline <= horizon,
                )
            ).order_by(Task.deadline.asc())
        )
    ).scalars().all()
    for t in tasks:
        dl = t.deadline.isoformat() if t.deadline else "no deadline"
        lines.append(f"TASK: {t.title} (due {dl}, priority {t.priority})")
        raw.append({"type": "task", "title": t.title, "deadline": dl})

    bills = (
        await db.execute(
            select(Bill).where(
                and_(Bill.user_id == user.id, Bill.status != "paid", Bill.due_date <= horizon)
            ).order_by(Bill.due_date.asc())
        )
    ).scalars().all()
    for b in bills:
        lines.append(f"BILL: {b.name} ({b.currency} {float(b.amount):.0f}) due {b.due_date.isoformat()}")
        raw.append({"type": "bill", "title": b.name, "deadline": b.due_date.isoformat()})

    meetings = (
        await db.execute(
            select(Meeting).where(
                and_(Meeting.user_id == user.id, Meeting.start_time >= now, Meeting.start_time <= horizon)
            ).order_by(Meeting.start_time.asc())
        )
    ).scalars().all()
    for m in meetings:
        lines.append(f"MEETING: {m.title} at {m.start_time.isoformat()}")
        raw.append({"type": "meeting", "title": m.title, "deadline": m.start_time.isoformat()})

    return lines, raw


def _fallback_plan(lines: list[str], raw: list[dict[str, Any]]) -> dict[str, Any]:
    """Used when the AI is unavailable — still gives a usable triaged list."""
    triage = [{"item": r["title"], "verdict": "do" if i < 3 else "defer", "why": "Sorted by nearest deadline"} for i, r in enumerate(raw)]
    schedule = [{"time": f"Block {i+1}", "action": f"Work on: {r['title']}", "minutes": 45} for i, r in enumerate(raw[:6])]
    return {
        "headline": f"{len(raw)} things in 48h — here's the survival order",
        "triage": triage,
        "schedule": schedule,
        "pep_talk": "One block at a time. You only have to do the next thing.",
    }


@router.post("", response_model=PanicPlanResponse)
async def create_panic_plan(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PanicPlanResponse:
    lines, raw = await _gather_48h(user, db)
    now = datetime.now(timezone.utc)

    if not raw:
        plan = {
            "headline": "Nothing urgent in the next 48h — breathe.",
            "triage": [],
            "schedule": [],
            "pep_talk": "You're actually ahead. Use this calm to get one step further.",
        }
    else:
        prompt = (
            f"Current time: {now.isoformat()}.\n"
            f"Everything due in the next 48 hours:\n" + "\n".join(lines)
        )
        try:
            completion = await openai_client.chat.completions.create(
                model=LLM_MODEL,
                response_format={"type": "json_object"},
                temperature=0.4,
                messages=[
                    {"role": "system", "content": _SYSTEM},
                    {"role": "user", "content": prompt},
                ],
            )
            plan = json.loads(completion.choices[0].message.content or "{}")
            if not plan.get("schedule") and not plan.get("triage"):
                plan = _fallback_plan(lines, raw)
        except (RateLimitError, APIError, json.JSONDecodeError):
            plan = _fallback_plan(lines, raw)

    # 16 bytes = 128 bits of entropy — unguessable for a public share link.
    token = secrets.token_urlsafe(16)
    record = PanicPlan(
        user_id=user.id,
        share_token=token,
        headline=str(plan.get("headline", "Survival plan")),
        owner_name=user.name,
        data=plan,
    )
    db.add(record)
    await db.flush()
    await db.refresh(record)

    return _to_response(record, len(raw))


def _to_response(record: PanicPlan, item_count: int) -> PanicPlanResponse:
    data = record.data or {}
    return PanicPlanResponse(
        id=record.id,
        share_token=record.share_token,
        headline=record.headline,
        triage=[TriageItem(item=str(t.get("item", "")), verdict=str(t.get("verdict", "do")), why=str(t.get("why", "")))
                for t in data.get("triage", []) if isinstance(t, dict)],
        schedule=[ScheduleBlock(time=str(s.get("time", "")), action=str(s.get("action", "")),
                                minutes=int(s["minutes"]) if str(s.get("minutes", "")).isdigit() else None)
                  for s in data.get("schedule", []) if isinstance(s, dict)],
        pep_talk=str(data.get("pep_talk", "")),
        item_count=item_count,
        created_at=record.created_at,
    )


class SharedPanicResponse(BaseModel):
    headline: str
    owner_name: str | None
    triage: list[TriageItem]
    schedule: list[ScheduleBlock]
    pep_talk: str
    created_at: datetime


@router.get("/share/{token}", response_model=SharedPanicResponse)
async def get_shared_panic(token: str, db: AsyncSession = Depends(get_db)) -> SharedPanicResponse:
    """Public — no auth. Powers the shareable link."""
    record = (
        await db.execute(select(PanicPlan).where(PanicPlan.share_token == token))
    ).scalar_one_or_none()
    if record is None:
        raise HTTPException(status_code=404, detail="Plan not found")
    data = record.data or {}
    return SharedPanicResponse(
        headline=record.headline,
        owner_name=record.owner_name,
        triage=[TriageItem(item=str(t.get("item", "")), verdict=str(t.get("verdict", "do")), why=str(t.get("why", "")))
                for t in data.get("triage", []) if isinstance(t, dict)],
        schedule=[ScheduleBlock(time=str(s.get("time", "")), action=str(s.get("action", "")),
                                minutes=int(s["minutes"]) if str(s.get("minutes", "")).isdigit() else None)
                  for s in data.get("schedule", []) if isinstance(s, dict)],
        pep_talk=str(data.get("pep_talk", "")),
        created_at=record.created_at,
    )
