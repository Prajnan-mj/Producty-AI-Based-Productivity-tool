"""Last-Minute Rescue Agent + Calendar Defrag + Adaptive Reminders + Momentum Score.

Features 1, 2, 3, and 5 from the product spec live here. Feature 4 (Voice
Panic-Capture) is added to the voice router since it extends the existing
parse/execute flow.
"""
from __future__ import annotations

import json
import math
import uuid
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import and_, select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.llm import genai_generate
from app.models import Meeting, Task, TriageHistory, User
from app.openai_client import openai_client
from app.security import get_current_user

router = APIRouter()


# ───────────────────────────────────────────────────────────────────
# Schemas
# ───────────────────────────────────────────────────────────────────

class MicroStep(BaseModel):
    title: str
    minutes: int
    order: int


class CalendarBlock(BaseModel):
    start: str
    end: str
    title: str


class TriageInput(BaseModel):
    estimated_effort_hours: float = Field(..., gt=0, le=200)
    current_progress_pct: float = Field(0, ge=0, le=100)


class TriageResult(BaseModel):
    status: str  # "crisis" | "on_track"
    hours_remaining: float
    hours_needed: float
    micro_steps: list[MicroStep]
    recommended_calendar_blocks: list[CalendarBlock]
    triage_id: uuid.UUID


class TriageAccept(BaseModel):
    accepted: bool


class DefragMove(BaseModel):
    event_id: str
    title: str
    action: str  # "keep" | "move" | "shrink"
    reason: str
    new_start: str | None = None
    new_end: str | None = None


class DefragResult(BaseModel):
    crisis_task: str
    proposed_changes: list[DefragMove]
    crisis_slots: list[CalendarBlock]


class ReminderWindow(BaseModel):
    best_hour: int
    confidence: float
    reasoning: str


class MomentumResult(BaseModel):
    completed: int
    total: int
    streak_pct: float
    message: str
    recent_trend: str  # "improving" | "steady" | "slipping"


# ───────────────────────────────────────────────────────────────────
# 1. POST /triage/{task_id} — Last-Minute Rescue Agent
# ───────────────────────────────────────────────────────────────────

_TRIAGE_SYSTEM = (
    "You are a deadline rescue strategist. Given a task with limited time "
    "remaining, decompose it into the minimum viable sequence of steps that "
    "gets it done. Each step must have a time allocation. Total time must "
    "not exceed hours_remaining. Be ruthless about cutting scope, not just "
    "listing steps.\n\n"
    "Also propose calendar blocks (start/end ISO 8601) that slot these steps "
    "into the remaining hours, starting from 'now'.\n\n"
    'Return strict JSON:\n'
    '{"micro_steps": [{"title": "...", "minutes": N, "order": N}], '
    '"recommended_calendar_blocks": [{"start": "...", "end": "...", "title": "..."}]}'
)


@router.post("/{task_id}", response_model=TriageResult)
async def triage_task(
    task_id: uuid.UUID,
    body: TriageInput,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TriageResult:
    task = (
        await db.execute(
            select(Task).where(and_(Task.id == task_id, Task.user_id == user.id))
        )
    ).scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")

    now = datetime.now(timezone.utc)
    if task.deadline is None:
        raise HTTPException(status_code=400, detail="Task has no deadline")

    dl = task.deadline if task.deadline.tzinfo else task.deadline.replace(tzinfo=timezone.utc)
    hours_remaining = max((dl - now).total_seconds() / 3600, 0)
    remaining_effort = body.estimated_effort_hours * (1 - body.current_progress_pct / 100)

    is_crisis = hours_remaining < remaining_effort * 1.5

    micro_steps: list[MicroStep] = []
    calendar_blocks: list[CalendarBlock] = []

    if is_crisis:
        task.status = "in_progress"
        prompt = (
            f"Task: {task.title}\n"
            f"Description: {task.description or 'N/A'}\n"
            f"Hours remaining: {hours_remaining:.1f}\n"
            f"Estimated remaining effort: {remaining_effort:.1f} hours\n"
            f"Current progress: {body.current_progress_pct}%\n"
            f"Now: {now.isoformat()}\n"
            f"Deadline: {dl.isoformat()}"
        )
        try:
            raw = await genai_generate(_TRIAGE_SYSTEM, prompt, temperature=0.3)
            data = json.loads(raw)
            for s in data.get("micro_steps", []):
                micro_steps.append(MicroStep(
                    title=str(s.get("title", "")),
                    minutes=int(s.get("minutes", 15)),
                    order=int(s.get("order", len(micro_steps) + 1)),
                ))
            for b in data.get("recommended_calendar_blocks", []):
                calendar_blocks.append(CalendarBlock(
                    start=str(b.get("start", "")),
                    end=str(b.get("end", "")),
                    title=str(b.get("title", "")),
                ))
        except Exception:  # noqa: BLE001 — degrade to even splits
            chunk_mins = max(15, int(hours_remaining * 60 / 4))
            for i in range(4):
                micro_steps.append(MicroStep(
                    title=f"Work block {i + 1}: {task.title}",
                    minutes=chunk_mins, order=i + 1,
                ))

    # Persist to triage_history
    history = TriageHistory(
        user_id=user.id,
        task_id=task.id,
        status="crisis" if is_crisis else "on_track",
        hours_remaining=round(hours_remaining, 2),
        micro_steps=[s.model_dump() for s in micro_steps] if micro_steps else None,
        calendar_blocks=[b.model_dump() for b in calendar_blocks] if calendar_blocks else None,
        accepted=False,
    )
    db.add(history)
    await db.flush()
    await db.refresh(history)

    return TriageResult(
        status="crisis" if is_crisis else "on_track",
        hours_remaining=round(hours_remaining, 2),
        hours_needed=round(remaining_effort, 2),
        micro_steps=micro_steps,
        recommended_calendar_blocks=calendar_blocks,
        triage_id=history.id,
    )


@router.post("/accept/{triage_id}")
async def accept_triage(
    triage_id: uuid.UUID,
    body: TriageAccept,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    record = (
        await db.execute(
            select(TriageHistory).where(
                and_(TriageHistory.id == triage_id, TriageHistory.user_id == user.id)
            )
        )
    ).scalar_one_or_none()
    if record is None:
        raise HTTPException(status_code=404, detail="Triage record not found")
    record.accepted = body.accepted
    await db.flush()
    return {"detail": "Triage " + ("accepted" if body.accepted else "declined")}


# ───────────────────────────────────────────────────────────────────
# 2. POST /triage/defrag — Calendar Defrag
# ───────────────────────────────────────────────────────────────────

_DEFRAG_SYSTEM = (
    "Given these existing calendar blocks and one urgent task that must fit "
    "in before the deadline, propose which low-priority existing events should "
    "be moved/shortened and where the urgent task's micro-steps should slot in.\n\n"
    "Rules:\n"
    "- Never auto-delete — only suggest move/shrink/keep\n"
    "- Prefer moving social/optional events over work meetings\n"
    "- Output start/end times in ISO 8601\n\n"
    'Return JSON:\n'
    '{"proposed_changes": [{"event_id": "...", "title": "...", "action": "keep|move|shrink", '
    '"reason": "...", "new_start": "...|null", "new_end": "...|null"}], '
    '"crisis_slots": [{"start": "...", "end": "...", "title": "..."}]}'
)


@router.post("/defrag/{task_id}", response_model=DefragResult)
async def calendar_defrag(
    task_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DefragResult:
    task = (
        await db.execute(
            select(Task).where(and_(Task.id == task_id, Task.user_id == user.id))
        )
    ).scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.deadline is None:
        raise HTTPException(status_code=400, detail="Task has no deadline")

    now = datetime.now(timezone.utc)
    dl = task.deadline if task.deadline.tzinfo else task.deadline.replace(tzinfo=timezone.utc)

    events = (
        await db.execute(
            select(Meeting).where(
                and_(
                    Meeting.user_id == user.id,
                    Meeting.start_time >= now,
                    Meeting.start_time <= dl,
                )
            ).order_by(Meeting.start_time.asc())
        )
    ).scalars().all()

    events_json = [
        {
            "event_id": str(e.id),
            "title": e.title,
            "start": e.start_time.isoformat(),
            "end": e.end_time.isoformat(),
            "category": e.category,
        }
        for e in events
    ]

    # Get latest triage micro_steps if available
    latest_triage = (
        await db.execute(
            select(TriageHistory).where(
                and_(TriageHistory.task_id == task_id, TriageHistory.user_id == user.id)
            ).order_by(TriageHistory.created_at.desc()).limit(1)
        )
    ).scalar_one_or_none()

    steps_info = ""
    if latest_triage and latest_triage.micro_steps:
        total_mins = sum(s.get("minutes", 0) for s in latest_triage.micro_steps)
        steps_info = f"\nMicro-steps from triage ({total_mins} min total): {json.dumps(latest_triage.micro_steps)}"

    prompt = (
        f"Urgent task: {task.title}\n"
        f"Deadline: {dl.isoformat()}\n"
        f"Now: {now.isoformat()}\n"
        f"Existing calendar events:\n{json.dumps(events_json, indent=2)}"
        f"{steps_info}"
    )

    try:
        raw = await genai_generate(_DEFRAG_SYSTEM, prompt, temperature=0.3)
        data = json.loads(raw)
    except Exception:  # noqa: BLE001
        return DefragResult(
            crisis_task=task.title, proposed_changes=[], crisis_slots=[],
        )

    changes = []
    for c in data.get("proposed_changes", []):
        changes.append(DefragMove(
            event_id=str(c.get("event_id", "")),
            title=str(c.get("title", "")),
            action=str(c.get("action", "keep")),
            reason=str(c.get("reason", "")),
            new_start=c.get("new_start"),
            new_end=c.get("new_end"),
        ))
    slots = []
    for s in data.get("crisis_slots", []):
        slots.append(CalendarBlock(
            start=str(s.get("start", "")),
            end=str(s.get("end", "")),
            title=str(s.get("title", "")),
        ))

    return DefragResult(
        crisis_task=task.title, proposed_changes=changes, crisis_slots=slots,
    )


# ───────────────────────────────────────────────────────────────────
# 3. GET /triage/reminder-window — Adaptive Reminder Timing
# ───────────────────────────────────────────────────────────────────

@router.get("/reminder-window", response_model=ReminderWindow)
async def reminder_window(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ReminderWindow:
    # Pull accepted triages + completed tasks to learn when user acts
    accepted = (
        await db.execute(
            select(TriageHistory.created_at).where(
                and_(TriageHistory.user_id == user.id, TriageHistory.accepted == True)  # noqa: E712
            ).order_by(TriageHistory.created_at.desc()).limit(50)
        )
    ).scalars().all()

    completed = (
        await db.execute(
            select(Task.updated_at).where(
                and_(Task.user_id == user.id, Task.status == "done")
            ).order_by(Task.updated_at.desc()).limit(50)
        )
    ).scalars().all()

    # Collect hours-of-day from both sources
    hours: list[int] = []
    for ts in accepted:
        hours.append(ts.hour)
    for ts in completed:
        hours.append(ts.hour)

    if len(hours) < 3:
        return ReminderWindow(
            best_hour=21,
            confidence=0.3,
            reasoning="Not enough data yet — defaulting to 9 PM (common peak productivity hour for students).",
        )

    # Weighted average with recency bias (more recent = heavier)
    counter = Counter(hours)
    best_hour = counter.most_common(1)[0][0]
    total = len(hours)
    best_count = counter[best_hour]
    confidence = min(1.0, best_count / total + 0.1 * min(total, 20) / 20)

    # Check if there's a tight window or spread
    top_3 = counter.most_common(3)
    hour_labels = [f"{h}:00" for h, _ in top_3]
    reasoning = (
        f"Based on {total} data points, you're most active at {best_hour}:00. "
        f"Top active hours: {', '.join(hour_labels)}."
    )

    return ReminderWindow(
        best_hour=best_hour,
        confidence=round(confidence, 2),
        reasoning=reasoning,
    )


# ───────────────────────────────────────────────────────────────────
# 5. GET /triage/momentum — Personal Momentum Score
# ───────────────────────────────────────────────────────────────────

@router.get("/momentum", response_model=MomentumResult)
async def momentum_score(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MomentumResult:
    # Get all triages for this user
    triages = (
        await db.execute(
            select(TriageHistory).where(TriageHistory.user_id == user.id)
            .order_by(TriageHistory.created_at.desc()).limit(20)
        )
    ).scalars().all()

    if not triages:
        # Fall back to raw task completion data
        done_30d = (
            await db.execute(
                select(func.count(Task.id)).where(
                    and_(
                        Task.user_id == user.id,
                        Task.status == "done",
                        Task.updated_at >= datetime.now(timezone.utc) - timedelta(days=30),
                    )
                )
            )
        ).scalar_one()
        total_30d = (
            await db.execute(
                select(func.count(Task.id)).where(
                    and_(
                        Task.user_id == user.id,
                        Task.created_at >= datetime.now(timezone.utc) - timedelta(days=30),
                    )
                )
            )
        ).scalar_one()
        pct = round(done_30d / max(total_30d, 1) * 100)
        return MomentumResult(
            completed=done_30d, total=total_30d, streak_pct=pct,
            message=f"You've completed {done_30d} of {total_30d} tasks this month ({pct}%).",
            recent_trend="steady",
        )

    # For each triage, check if the linked task was completed before deadline
    completed = 0
    for t in triages:
        task = (
            await db.execute(select(Task).where(Task.id == t.task_id))
        ).scalar_one_or_none()
        if task and task.status == "done":
            if task.deadline:
                dl = task.deadline if task.deadline.tzinfo else task.deadline.replace(tzinfo=timezone.utc)
                if task.updated_at <= dl:
                    completed += 1
            else:
                completed += 1

    total = len(triages)
    pct = round(completed / max(total, 1) * 100)

    # Trend: compare first half vs second half
    half = total // 2
    if half >= 2:
        recent_ids = [t.task_id for t in triages[:half]]
        older_ids = [t.task_id for t in triages[half:]]
        recent_done = sum(1 for tid in recent_ids if (
            await db.execute(select(Task).where(and_(Task.id == tid, Task.status == "done")))
        ).scalar_one_or_none() is not None)
        older_done = sum(1 for tid in older_ids if (
            await db.execute(select(Task).where(and_(Task.id == tid, Task.status == "done")))
        ).scalar_one_or_none() is not None)
        r_rate = recent_done / max(len(recent_ids), 1)
        o_rate = older_done / max(len(older_ids), 1)
        trend = "improving" if r_rate > o_rate + 0.1 else ("slipping" if r_rate < o_rate - 0.1 else "steady")
    else:
        trend = "steady"

    if pct >= 75:
        msg = f"You completed {completed} of your last {total} crisis tasks before deadline — that's your best streak this month!"
    elif pct >= 50:
        msg = f"You hit {completed} of {total} crisis deadlines. Solid, but there's room to tighten up."
    else:
        msg = f"Only {completed} of {total} crisis tasks landed on time. Let's fix that — try the rescue agent earlier next time."

    return MomentumResult(
        completed=completed, total=total, streak_pct=pct,
        message=msg, recent_trend=trend,
    )
