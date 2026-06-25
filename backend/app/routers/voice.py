from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.openai_client import openai_client, LLM_MODEL
from app.models import Bill, Habit, Meeting, Note, Task, TriageHistory, User
from app.security import get_current_user

router = APIRouter()

VALID_ACTIONS = {
    "create_task",
    "add_bill",
    "set_meeting",
    "add_habit",
    "set_deadline",
    "create_note",
    "panic_triage",
    "unknown",
}


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class ParseRequest(BaseModel):
    transcript: str = Field(..., min_length=1, max_length=2000)


class ParsedAction(BaseModel):
    action: str
    confidence: float
    extracted_data: dict[str, Any]
    confirmation_message: str


class ExecuteRequest(BaseModel):
    action: str = Field(...)
    extracted_data: dict[str, Any]
    confirmed: bool


class ExecuteResponse(BaseModel):
    success: bool
    created_item: dict[str, Any]
    message: str


# ---------------------------------------------------------------------------
# Parse prompt
# ---------------------------------------------------------------------------

_PARSE_SYSTEM = """\
You parse voice commands into structured actions.
The user speaks naturally — extract the intent and all relevant details.

Possible actions:
  create_task  → fields: title, description, deadline (ISO 8601 or null), priority ("high"|"medium"|"low")
  add_bill     → fields: name, amount (number), currency ("INR"|"USD"), due_date (ISO 8601), recurrence ("one-time"|"monthly"|"weekly"|"yearly"), category ("subscription"|"utility"|"insurance"|"rent"|"other")
  set_meeting  → fields: title, start_time (ISO 8601), end_time (ISO 8601 or null), category ("personal"|"professional"), description
  add_habit    → fields: title, frequency ("daily"|"weekly"), duration_minutes (int or null)
  set_deadline → fields: title, deadline (ISO 8601), priority ("high"|"medium"|"low")
  create_note  → fields: title, content (the body of the note)
  panic_triage → fields: title, deadline (ISO 8601), estimated_effort_hours (number), current_progress_pct (number 0-100)
    Use this when the user sounds panicked about a deadline, e.g. "I have an exam tomorrow at 9am and haven't started" or "my project is due in 3 hours"

Date/time rules:
  - "tomorrow" = the next calendar day
  - "Friday"   = the coming Friday
  - "the 15th" = the 15th of the current or next month
  - If no time is given for meetings, default to 09:00
  - Always output dates in ISO 8601 with timezone offset

Return strict JSON:
{
  "action": "<one of the actions above, or 'unknown'>",
  "confidence": <0.0 to 1.0>,
  "extracted_data": { <action-specific fields> },
  "confirmation_message": "<human-readable summary of what will be created>"
}
"""


# ---------------------------------------------------------------------------
# 1. POST /voice/parse
# ---------------------------------------------------------------------------

@router.post("/parse", response_model=ParsedAction)
async def parse_voice(
    body: ParseRequest,
    user: User = Depends(get_current_user),
) -> ParsedAction:
    now = datetime.now(timezone.utc)

    completion = await openai_client.chat.completions.create(
        model=LLM_MODEL,
        response_format={"type": "json_object"},
        temperature=0,
        messages=[
            {"role": "system", "content": _PARSE_SYSTEM},
            {
                "role": "user",
                "content": (
                    f"Current date/time: {now.isoformat()}\n"
                    f"Transcript: '{body.transcript}'"
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

    action = str(data.get("action", "unknown"))
    if action not in VALID_ACTIONS:
        action = "unknown"

    try:
        confidence = float(data.get("confidence", 0.5))
    except (TypeError, ValueError):
        confidence = 0.5
    confidence = max(0.0, min(1.0, confidence))

    return ParsedAction(
        action=action,
        confidence=confidence,
        extracted_data=data.get("extracted_data", {}),
        confirmation_message=str(
            data.get("confirmation_message", "Could not parse the command.")
        ),
    )


# ---------------------------------------------------------------------------
# Execute helpers
# ---------------------------------------------------------------------------

def _parse_dt(value: Any) -> datetime | None:
    """Best-effort ISO 8601 parse, returning None on failure."""
    if not value or not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


async def _exec_create_task(
    data: dict[str, Any], user: User, db: AsyncSession
) -> dict[str, Any]:
    title = str(data.get("title", "")).strip()
    if not title:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Task title is required")

    priority = str(data.get("priority", "medium")).lower()
    if priority not in ("high", "medium", "low"):
        priority = "medium"

    task = Task(
        user_id=user.id,
        title=title,
        description=data.get("description"),
        deadline=_parse_dt(data.get("deadline")),
        priority=priority,
        status="pending",
        source="voice",
    )
    db.add(task)
    await db.flush()
    await db.refresh(task)
    return {
        "id": str(task.id),
        "title": task.title,
        "deadline": task.deadline.isoformat() if task.deadline else None,
        "priority": task.priority,
    }


async def _exec_add_bill(
    data: dict[str, Any], user: User, db: AsyncSession
) -> dict[str, Any]:
    name = str(data.get("name", "")).strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bill name is required")

    due_date = _parse_dt(data.get("due_date"))
    if due_date is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bill due date is required")

    try:
        amount = float(data.get("amount", 0))
    except (TypeError, ValueError):
        amount = 0.0

    currency = str(data.get("currency", "INR")).upper()
    if currency not in ("INR", "USD"):
        currency = "INR"

    recurrence = str(data.get("recurrence", "one-time"))
    if recurrence not in ("one-time", "monthly", "weekly", "yearly"):
        recurrence = "one-time"

    category = str(data.get("category", "other")).lower()
    if category not in ("subscription", "utility", "insurance", "rent", "other"):
        category = "other"

    bill = Bill(
        user_id=user.id,
        name=name,
        amount=amount,
        currency=currency,
        due_date=due_date,
        recurrence=recurrence,
        category=category,
        platform="manual",
        status="pending",
        autopay_enabled=False,
        notes=f"Created via voice: {name}",
    )
    db.add(bill)
    await db.flush()
    await db.refresh(bill)
    return {
        "id": str(bill.id),
        "name": bill.name,
        "amount": float(bill.amount),
        "currency": bill.currency,
        "due_date": bill.due_date.isoformat(),
    }


async def _exec_set_meeting(
    data: dict[str, Any], user: User, db: AsyncSession
) -> dict[str, Any]:
    title = str(data.get("title", "")).strip()
    if not title:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Meeting title is required")

    start = _parse_dt(data.get("start_time"))
    if start is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Meeting start time is required")

    end = _parse_dt(data.get("end_time"))
    if end is None:
        end = start + timedelta(hours=1)

    category = str(data.get("category", "professional")).lower()
    if category not in ("personal", "professional"):
        category = "professional"

    meeting = Meeting(
        user_id=user.id,
        google_event_id=f"voice_{int(datetime.now(timezone.utc).timestamp())}",
        title=title,
        start_time=start,
        end_time=end,
        category=category,
        is_deadline=False,
        description=data.get("description"),
        attendee_count=0,
    )
    db.add(meeting)
    await db.flush()
    await db.refresh(meeting)
    return {
        "id": str(meeting.id),
        "title": meeting.title,
        "start_time": meeting.start_time.isoformat(),
        "end_time": meeting.end_time.isoformat(),
        "category": meeting.category,
    }


async def _exec_add_habit(
    data: dict[str, Any], user: User, db: AsyncSession
) -> dict[str, Any]:
    title = str(data.get("title", "")).strip()
    if not title:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Habit title is required")

    frequency = str(data.get("frequency", "daily")).lower()
    if frequency not in ("daily", "weekly"):
        frequency = "daily"

    category = str(data.get("category", "personal")).lower()
    if category not in ("health", "learning", "work", "personal"):
        category = "personal"

    duration: int | None = None
    raw_dur = data.get("duration_minutes")
    if raw_dur is not None:
        try:
            duration = int(raw_dur)
        except (TypeError, ValueError):
            duration = None

    description = f"{duration} minutes" if duration else None

    habit = Habit(
        user_id=user.id,
        name=title,
        description=description,
        frequency=frequency,
        category=category,
        is_active=True,
    )
    db.add(habit)
    await db.flush()
    await db.refresh(habit)
    return {
        "id": str(habit.id),
        "title": habit.title,
        "frequency": habit.frequency,
        "duration_minutes": habit.duration_minutes,
    }


async def _exec_set_deadline(
    data: dict[str, Any], user: User, db: AsyncSession
) -> dict[str, Any]:
    title = str(data.get("title", "")).strip()
    if not title:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Deadline title is required")

    deadline = _parse_dt(data.get("deadline"))
    if deadline is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Deadline date is required")

    priority = str(data.get("priority", "high")).lower()
    if priority not in ("high", "medium", "low"):
        priority = "high"

    task = Task(
        user_id=user.id,
        title=title,
        description=f"Deadline set via voice command",
        deadline=deadline,
        priority=priority,
        status="pending",
        source="voice",
    )
    db.add(task)
    await db.flush()
    await db.refresh(task)
    return {
        "id": str(task.id),
        "title": task.title,
        "deadline": task.deadline.isoformat() if task.deadline else None,
        "priority": task.priority,
    }


async def _exec_create_note(
    data: dict[str, Any], user: User, db: AsyncSession
) -> dict[str, Any]:
    title = str(data.get("title", "")).strip() or "Voice note"
    content = str(data.get("content", "")).strip()
    note = Note(user_id=user.id, title=title, content=content)
    db.add(note)
    await db.flush()
    await db.refresh(note)
    return {"id": str(note.id), "title": note.title}


async def _exec_panic_triage(
    data: dict[str, Any], user: User, db: AsyncSession
) -> dict[str, Any]:
    """Create a task and immediately run triage on it."""
    title = str(data.get("title", "")).strip()
    if not title:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Task title is required")

    deadline = _parse_dt(data.get("deadline"))
    if deadline is None:
        deadline = datetime.now(timezone.utc) + timedelta(hours=12)

    task = Task(
        user_id=user.id, title=title, description="Created via voice panic capture",
        deadline=deadline, priority="high", status="pending", source="voice",
    )
    db.add(task)
    await db.flush()
    await db.refresh(task)

    try:
        effort = float(data.get("estimated_effort_hours", 4))
    except (TypeError, ValueError):
        effort = 4.0
    try:
        progress = float(data.get("current_progress_pct", 0))
    except (TypeError, ValueError):
        progress = 0.0

    now = datetime.now(timezone.utc)
    dl = deadline if deadline.tzinfo else deadline.replace(tzinfo=timezone.utc)
    hours_remaining = max((dl - now).total_seconds() / 3600, 0)
    remaining_effort = effort * (1 - progress / 100)
    is_crisis = hours_remaining < remaining_effort * 1.5

    from app.llm import genai_generate
    import json as _json

    micro_steps = []
    if is_crisis:
        _sys = (
            "You are a deadline rescue strategist. Decompose this task into minimum "
            "viable steps that fit within the time remaining. Be ruthless about scope.\n"
            'Return JSON: {"micro_steps": [{"title": "...", "minutes": N, "order": N}]}'
        )
        try:
            raw = await genai_generate(_sys, f"Task: {title}\nHours left: {hours_remaining:.1f}\nEffort needed: {remaining_effort:.1f}h", temperature=0.3)
            micro_steps = _json.loads(raw).get("micro_steps", [])
        except Exception:  # noqa: BLE001
            chunk = max(15, int(hours_remaining * 60 / 4))
            micro_steps = [{"title": f"Block {i+1}", "minutes": chunk, "order": i+1} for i in range(4)]

    history = TriageHistory(
        user_id=user.id, task_id=task.id,
        status="crisis" if is_crisis else "on_track",
        hours_remaining=round(hours_remaining, 2),
        micro_steps=micro_steps or None,
        accepted=False,
    )
    db.add(history)
    await db.flush()

    return {
        "id": str(task.id),
        "title": task.title,
        "deadline": task.deadline.isoformat(),
        "status": "crisis" if is_crisis else "on_track",
        "hours_remaining": round(hours_remaining, 1),
        "micro_steps": micro_steps[:6],
        "triage_id": str(history.id),
    }


_EXECUTORS: dict[str, Any] = {
    "create_task": _exec_create_task,
    "add_bill": _exec_add_bill,
    "set_meeting": _exec_set_meeting,
    "add_habit": _exec_add_habit,
    "set_deadline": _exec_set_deadline,
    "create_note": _exec_create_note,
    "panic_triage": _exec_panic_triage,
}


# ---------------------------------------------------------------------------
# 2. POST /voice/execute
# ---------------------------------------------------------------------------

@router.post("/execute", response_model=ExecuteResponse)
async def execute_voice_action(
    body: ExecuteRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ExecuteResponse:
    if not body.confirmed:
        return ExecuteResponse(
            success=False,
            created_item={},
            message="Action was not confirmed by the user.",
        )

    if body.action == "unknown":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot execute an unknown action. Please rephrase your command.",
        )

    executor = _EXECUTORS.get(body.action)
    if executor is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported action: {body.action}",
        )

    created = await executor(body.extracted_data, user, db)

    action_labels = {
        "create_task": "Task",
        "add_bill": "Bill",
        "set_meeting": "Meeting",
        "add_habit": "Habit",
        "set_deadline": "Deadline task",
        "create_note": "Note",
        "panic_triage": "Panic rescue plan",
    }

    return ExecuteResponse(
        success=True,
        created_item=created,
        message=f"{action_labels.get(body.action, 'Item')} created successfully.",
    )
