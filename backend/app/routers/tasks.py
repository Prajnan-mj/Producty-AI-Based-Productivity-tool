from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.openai_client import openai_client, LLM_MODEL
from app.models import SnoozeLog, Task, User
from app.security import get_current_user
from app.services.google_service import ExtractedTask, extract_tasks_from_gmail

router = APIRouter()


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class TaskCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=1024)
    description: str | None = None
    deadline: datetime | None = None
    priority: str = Field(default="medium", pattern=r"^(high|medium|low)$")


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=1024)
    description: str | None = None
    deadline: datetime | None = None
    priority: str | None = Field(default=None, pattern=r"^(high|medium|low)$")
    status: str | None = Field(default=None, pattern=r"^(pending|in_progress|done)$")


class TaskResponse(BaseModel):
    id: uuid.UUID
    title: str
    description: str | None
    deadline: datetime | None
    priority: str
    status: str
    source: str
    source_email_id: str | None
    days_until_deadline: int | None
    created_at: datetime
    updated_at: datetime


class TaskListResponse(BaseModel):
    items: list[TaskResponse]
    total: int
    limit: int
    offset: int


class UrgentTaskResponse(TaskResponse):
    risk_score: float


class PrioritySuggestion(BaseModel):
    task_id: uuid.UUID
    current_priority: str
    suggested_priority: str
    reasoning: str
    suggested_deadline_adjustment: str | None


class PrioritizeResponse(BaseModel):
    suggestions: list[PrioritySuggestion]


class DeleteResponse(BaseModel):
    detail: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _days_until_deadline(deadline: datetime | None) -> int | None:
    if deadline is None:
        return None
    now = datetime.now(timezone.utc)
    dl = deadline if deadline.tzinfo else deadline.replace(tzinfo=timezone.utc)
    return max((dl - now).days, 0)


def _task_to_response(task: Task) -> TaskResponse:
    return TaskResponse(
        id=task.id,
        title=task.title,
        description=task.description,
        deadline=task.deadline,
        priority=task.priority,
        status=task.status,
        source=task.source,
        source_email_id=task.source_email_id,
        days_until_deadline=_days_until_deadline(task.deadline),
        created_at=task.created_at,
        updated_at=task.updated_at,
    )


async def _get_user_task(
    task_id: uuid.UUID, user: User, db: AsyncSession
) -> Task:
    result = await db.execute(
        select(Task).where(
            and_(Task.id == task_id, Task.user_id == user.id)
        )
    )
    task = result.scalar_one_or_none()
    if task is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found",
        )
    return task


# ---------------------------------------------------------------------------
# 1. GET /tasks  — paginated list with filters
# ---------------------------------------------------------------------------

@router.get("", response_model=TaskListResponse)
async def list_tasks(
    status_filter: str | None = Query(default=None, alias="status"),
    priority: str | None = Query(default=None),
    deadline_before: datetime | None = Query(default=None),
    sort_by: str = Query(default="created", pattern=r"^(deadline|priority|created)$"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TaskListResponse:
    stmt = select(Task).where(Task.user_id == user.id)

    if status_filter:
        if status_filter not in ("pending", "in_progress", "done"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="status must be 'pending', 'in_progress', or 'done'",
            )
        stmt = stmt.where(Task.status == status_filter)

    if priority:
        if priority not in ("high", "medium", "low"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="priority must be 'high', 'medium', or 'low'",
            )
        stmt = stmt.where(Task.priority == priority)

    if deadline_before:
        stmt = stmt.where(Task.deadline <= deadline_before)

    # Count total before pagination — single scalar count.
    count_stmt = select(func.count()).select_from(
        stmt.with_only_columns(Task.id).subquery()
    )
    total = (await db.execute(count_stmt)).scalar_one()

    # Sorting.
    priority_order = {"high": 1, "medium": 2, "low": 3}
    if sort_by == "deadline":
        stmt = stmt.order_by(Task.deadline.asc().nulls_last())
    elif sort_by == "priority":
        stmt = stmt.order_by(
            case(priority_order, value=Task.priority).asc()
        )
    else:
        stmt = stmt.order_by(Task.created_at.desc())

    stmt = stmt.offset(offset).limit(limit)
    result = await db.execute(stmt)
    tasks = result.scalars().all()

    return TaskListResponse(
        items=[_task_to_response(t) for t in tasks],
        total=total,
        limit=limit,
        offset=offset,
    )


# ---------------------------------------------------------------------------
# 2. POST /tasks  — create
# ---------------------------------------------------------------------------

@router.post("", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
async def create_task(
    body: TaskCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TaskResponse:
    task = Task(
        user_id=user.id,
        title=body.title,
        description=body.description,
        deadline=body.deadline,
        priority=body.priority,
        status="pending",
        source="manual",
    )
    db.add(task)
    await db.flush()
    await db.refresh(task)
    return _task_to_response(task)


# ---------------------------------------------------------------------------
# 3. PATCH /tasks/{task_id}  — partial update
# ---------------------------------------------------------------------------

@router.patch("/{task_id}", response_model=TaskResponse)
async def update_task(
    task_id: uuid.UUID,
    body: TaskUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TaskResponse:
    task = await _get_user_task(task_id, user, db)

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(task, field, value)

    await db.flush()
    await db.refresh(task)
    return _task_to_response(task)


# ---------------------------------------------------------------------------
# 4. DELETE /tasks/{task_id}
# ---------------------------------------------------------------------------

@router.delete("/{task_id}", response_model=DeleteResponse)
async def delete_task(
    task_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DeleteResponse:
    task = await _get_user_task(task_id, user, db)
    await db.delete(task)
    await db.flush()
    return DeleteResponse(detail="Task deleted")


# ---------------------------------------------------------------------------
# 5. POST /tasks/prioritize  — AI suggestions (review-only)
# ---------------------------------------------------------------------------

_PRIORITIZE_SYSTEM_PROMPT = (
    "You are a productivity assistant. The user will give you a list of their "
    "pending tasks. For each task, suggest a priority (high / medium / low) and "
    "a brief reasoning. If the deadline should be adjusted, suggest an "
    "adjustment (e.g., 'move 2 days earlier'). "
    "Return strict JSON: a list of objects with keys: "
    "task_id (string), suggested_priority, reasoning, "
    "suggested_deadline_adjustment (string or null)."
)


@router.post("/prioritize", response_model=PrioritizeResponse)
async def prioritize_tasks(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PrioritizeResponse:
    result = await db.execute(
        select(Task).where(
            and_(Task.user_id == user.id, Task.status == "pending")
        )
    )
    pending_tasks = result.scalars().all()

    if not pending_tasks:
        return PrioritizeResponse(suggestions=[])

    task_descriptions: list[dict[str, Any]] = []
    for t in pending_tasks:
        task_descriptions.append({
            "task_id": str(t.id),
            "title": t.title,
            "description": t.description,
            "deadline": t.deadline.isoformat() if t.deadline else None,
            "current_priority": t.priority,
            "days_until_deadline": _days_until_deadline(t.deadline),
        })

    completion = await openai_client.chat.completions.create(
        model=LLM_MODEL,
        response_format={"type": "json_object"},
        temperature=0,
        messages=[
            {"role": "system", "content": _PRIORITIZE_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    f"Today is {datetime.now(timezone.utc).date().isoformat()}. "
                    f"Here are my pending tasks:\n{json.dumps(task_descriptions)}"
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

    # GPT may wrap the list under various keys; handle flexibly.
    items: list[dict[str, Any]]
    if isinstance(data, list):
        items = data
    elif "suggestions" in data:
        items = data["suggestions"]
    elif "tasks" in data:
        items = data["tasks"]
    else:
        first_list = next((v for v in data.values() if isinstance(v, list)), [])
        items = first_list

    task_id_set: set[str] = {str(t.id) for t in pending_tasks}
    priority_by_id: dict[str, str] = {str(t.id): t.priority for t in pending_tasks}

    suggestions: list[PrioritySuggestion] = []
    for item in items:
        tid = str(item.get("task_id", ""))
        if tid not in task_id_set:
            continue
        suggested = str(item.get("suggested_priority", "medium")).lower()
        if suggested not in ("high", "medium", "low"):
            suggested = "medium"
        suggestions.append(
            PrioritySuggestion(
                task_id=uuid.UUID(tid),
                current_priority=priority_by_id.get(tid, "medium"),
                suggested_priority=suggested,
                reasoning=str(item.get("reasoning", "")),
                suggested_deadline_adjustment=item.get("suggested_deadline_adjustment"),
            )
        )

    return PrioritizeResponse(suggestions=suggestions)


# ---------------------------------------------------------------------------
# 6. GET /tasks/urgent  — due within 24 h with risk score
# ---------------------------------------------------------------------------

@router.get("/urgent", response_model=list[UrgentTaskResponse])
async def urgent_tasks(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[UrgentTaskResponse]:
    now = datetime.now(timezone.utc)
    window = now + timedelta(hours=24)

    result = await db.execute(
        select(Task).where(
            and_(
                Task.user_id == user.id,
                Task.deadline.isnot(None),
                Task.deadline <= window,
                Task.deadline >= now,
                Task.status != "done",
            )
        ).order_by(Task.deadline.asc())
    )
    tasks = result.scalars().all()

    urgent: list[UrgentTaskResponse] = []
    for t in tasks:
        dl = t.deadline
        if dl.tzinfo is None:
            dl = dl.replace(tzinfo=timezone.utc)
        hours_remaining = max((dl - now).total_seconds() / 3600, 0.1)
        risk_score = min(100.0, (1.0 / hours_remaining) * 1000)

        urgent.append(
            UrgentTaskResponse(
                id=t.id,
                title=t.title,
                description=t.description,
                deadline=t.deadline,
                priority=t.priority,
                status=t.status,
                source=t.source,
                source_email_id=t.source_email_id,
                days_until_deadline=_days_until_deadline(t.deadline),
                created_at=t.created_at,
                updated_at=t.updated_at,
                risk_score=round(risk_score, 1),
            )
        )

    return urgent


# ---------------------------------------------------------------------------
# Gmail extraction (existing)
# ---------------------------------------------------------------------------

@router.get("/from-gmail", response_model=list[ExtractedTask])
async def tasks_from_gmail(
    max_results: int = Query(default=20, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ExtractedTask]:
    return await extract_tasks_from_gmail(user, db, max_results=max_results)


# ---------------------------------------------------------------------------
# Procrastination detector
# ---------------------------------------------------------------------------

class ProcrastinationItem(BaseModel):
    task_id: uuid.UUID
    title: str
    snooze_count: int
    deadline: datetime | None
    hours_left: float | None


@router.get("/procrastination/flagged", response_model=list[ProcrastinationItem])
async def procrastination_flagged(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ProcrastinationItem]:
    """Tasks the user has snoozed 2+ times and still hasn't finished."""
    counts = (
        await db.execute(
            select(SnoozeLog.item_id, func.count(SnoozeLog.id).label("n"))
            .where(and_(SnoozeLog.user_id == user.id, SnoozeLog.item_type == "task"))
            .group_by(SnoozeLog.item_id)
            .having(func.count(SnoozeLog.id) >= 2)
        )
    ).all()
    if not counts:
        return []

    now = datetime.now(timezone.utc)
    by_id = {row[0]: row[1] for row in counts}
    tasks = (
        await db.execute(
            select(Task).where(
                and_(Task.user_id == user.id, Task.id.in_(list(by_id.keys())), Task.status != "done")
            )
        )
    ).scalars().all()

    out: list[ProcrastinationItem] = []
    for t in tasks:
        hours_left = None
        if t.deadline is not None:
            dl = t.deadline if t.deadline.tzinfo else t.deadline.replace(tzinfo=timezone.utc)
            hours_left = round((dl - now).total_seconds() / 3600, 1)
        out.append(ProcrastinationItem(
            task_id=t.id, title=t.title, snooze_count=by_id[t.id],
            deadline=t.deadline, hours_left=hours_left,
        ))
    out.sort(key=lambda x: x.snooze_count, reverse=True)
    return out


class NextActionResponse(BaseModel):
    recommended_task_id: uuid.UUID | None = None
    title: str
    reason: str
    suggested_subscope: str | None = None


@router.get("/next-action", response_model=NextActionResponse)
async def next_action(
    available_minutes: int = Query(default=30, ge=5, le=480),
    energy: str = Query(default="med", pattern=r"^(low|med|high)$"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> NextActionResponse:
    """Feature 3: Returns exactly ONE task to do right now."""
    result = await db.execute(
        select(Task).where(
            and_(Task.user_id == user.id, Task.status != "done")
        ).order_by(Task.deadline.asc().nulls_last()).limit(15)
    )
    tasks = result.scalars().all()
    if not tasks:
        return NextActionResponse(
            title="Nothing on your plate",
            reason="All tasks are done — pick something you've been wanting to start.",
        )

    now = datetime.now(timezone.utc)
    lines = "\n".join(
        f"- id:{t.id} \"{t.title}\" priority={t.priority} "
        f"deadline={t.deadline.isoformat() if t.deadline else 'none'} "
        f"status={t.status}"
        for t in tasks
    )
    system = (
        "Given this list of pending tasks (with deadline, priority) plus the user's "
        "available time window and stated energy level, recommend exactly ONE task to "
        "do right now. Explain in one sentence why this beats the alternatives. If the "
        "best option doesn't fit available_minutes, suggest a sub-step instead "
        "(e.g. 'Just outline the intro, not the whole essay').\n\n"
        'Return strict JSON: {"task_id": "...", "reason": "...", "suggested_subscope": "..." or null}'
    )
    prompt = (
        f"Now: {now.isoformat()}\n"
        f"Available: {available_minutes} minutes\n"
        f"Energy: {energy}\n\n"
        f"Tasks:\n{lines}"
    )

    try:
        raw = await openai_client.chat.completions.create(
            model=LLM_MODEL,
            response_format={"type": "json_object"},
            temperature=0.3,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
        )
        data: dict[str, Any] = json.loads(raw.choices[0].message.content or "{}")
    except Exception:
        top = tasks[0]
        return NextActionResponse(
            recommended_task_id=top.id,
            title=top.title,
            reason="Start with your most urgent task.",
        )

    tid_str = str(data.get("task_id", ""))
    task_map = {str(t.id): t for t in tasks}
    matched = task_map.get(tid_str)
    return NextActionResponse(
        recommended_task_id=matched.id if matched else tasks[0].id,
        title=matched.title if matched else tasks[0].title,
        reason=str(data.get("reason", "")),
        suggested_subscope=data.get("suggested_subscope"),
    )


class AvoidanceNudge(BaseModel):
    task_id: uuid.UUID
    title: str
    snooze_count: int
    days_stuck: int
    intervention: str
    intervention_type: str  # "starter" | "reframe" | "drop"


@router.get("/avoidance-patterns", response_model=list[AvoidanceNudge])
async def avoidance_patterns(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[AvoidanceNudge]:
    """Feature 4: Gentle nudges for chronically-avoided tasks."""
    counts = (
        await db.execute(
            select(
                SnoozeLog.item_id,
                func.count(SnoozeLog.id).label("n"),
                func.min(SnoozeLog.created_at).label("first"),
            )
            .where(and_(SnoozeLog.user_id == user.id, SnoozeLog.item_type == "task"))
            .group_by(SnoozeLog.item_id)
            .having(func.count(SnoozeLog.id) >= 3)
        )
    ).all()
    if not counts:
        return []

    now = datetime.now(timezone.utc)
    nudges: list[AvoidanceNudge] = []

    for item_id, snooze_count, first_snooze in counts:
        task = (
            await db.execute(
                select(Task).where(and_(Task.id == item_id, Task.user_id == user.id, Task.status != "done"))
            )
        ).scalar_one_or_none()
        if task is None:
            continue

        days_stuck = (now - first_snooze.replace(tzinfo=timezone.utc) if first_snooze.tzinfo is None else now - first_snooze).days

        system = (
            "This task has been deferred multiple times. Suggest ONE concrete "
            "intervention. Be kind and constructive, never shaming.\n"
            'Return JSON: {"intervention": "...", "type": "starter|reframe|drop"}\n'
            "- starter: a 2-minute micro-task to break inertia\n"
            "- reframe: evidence it's mis-scoped and needs splitting\n"
            "- drop: evidence it's not actually a priority"
        )
        prompt = (
            f"Task: \"{task.title}\"\n"
            f"Deferred {snooze_count} times over {days_stuck} days.\n"
            f"Description: {task.description or 'none'}"
        )

        try:
            completion = await openai_client.chat.completions.create(
                model=LLM_MODEL,
                response_format={"type": "json_object"},
                temperature=0.4,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": prompt},
                ],
            )
            data = json.loads(completion.choices[0].message.content or "{}")
            intervention = str(data.get("intervention", "Try spending just 2 minutes on the very first step."))
            itype = str(data.get("type", "starter"))
            if itype not in ("starter", "reframe", "drop"):
                itype = "starter"
        except Exception:
            intervention = f"Try just 2 minutes on \"{task.title}\" — often starting is the hardest part."
            itype = "starter"

        nudges.append(AvoidanceNudge(
            task_id=task.id, title=task.title, snooze_count=snooze_count,
            days_stuck=days_stuck, intervention=intervention, intervention_type=itype,
        ))

    nudges.sort(key=lambda n: n.snooze_count, reverse=True)
    return nudges


class ChunkResponse(BaseModel):
    created: list[str]


@router.post("/{task_id}/break-into-chunks", response_model=ChunkResponse)
async def break_into_chunks(
    task_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ChunkResponse:
    task = (
        await db.execute(select(Task).where(and_(Task.id == task_id, Task.user_id == user.id)))
    ).scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")

    try:
        completion = await openai_client.chat.completions.create(
            model=LLM_MODEL,
            response_format={"type": "json_object"},
            temperature=0.3,
            messages=[
                {"role": "system", "content": "Break a dreaded task into 3-6 concrete steps that each take about 15 minutes. Return JSON {\"steps\": [\"...\"]}."},
                {"role": "user", "content": f"Task: {task.title}"},
            ],
        )
        steps = json.loads(completion.choices[0].message.content or "{}").get("steps", [])
    except Exception:  # noqa: BLE001
        steps = [f"15 min on: {task.title} (part {i + 1})" for i in range(3)]

    created: list[str] = []
    for s in steps[:6]:
        text = str(s).strip()
        if not text:
            continue
        sub = Task(
            user_id=user.id, title=f"[15m] {text}", description=f"Chunk of: {task.title}",
            deadline=task.deadline, priority=task.priority, status="pending", source="manual",
        )
        db.add(sub)
        created.append(sub.title)
    await db.flush()
    return ChunkResponse(created=created)
