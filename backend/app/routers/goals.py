from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.openai_client import openai_client, LLM_MODEL
from app.models import Goal, GoalMilestone, User
from app.security import get_current_user

router = APIRouter()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class MilestoneCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=1024)
    target_date: date


class MilestoneResponse(BaseModel):
    id: uuid.UUID
    title: str
    target_date: date
    is_completed: bool
    completed_at: datetime | None


class GoalCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=1024)
    description: str | None = None
    goal_type: str = Field(default="short_term", pattern=r"^(short_term|long_term)$")
    timeframe_days: int = Field(..., ge=1, le=365)
    category: str = Field(
        default="personal",
        pattern=r"^(health|career|learning|finance|personal)$",
    )
    milestones: list[MilestoneCreate] = Field(default_factory=list)


class GoalResponse(BaseModel):
    id: uuid.UUID
    title: str
    description: str | None
    goal_type: str
    timeframe_days: int
    start_date: date
    end_date: date
    progress_percentage: float
    status: str
    category: str
    days_remaining: int
    on_track_status: str
    milestones: list[MilestoneResponse]
    created_at: datetime


class ProgressUpdate(BaseModel):
    progress_percentage: float = Field(..., ge=0, le=100)
    notes: str | None = None


class ProgressPoint(BaseModel):
    date: str
    percentage: float


class MilestoneMarker(BaseModel):
    date: str
    title: str
    is_completed: bool


class VisualData(BaseModel):
    progress_over_time: list[ProgressPoint]
    milestone_markers: list[MilestoneMarker]
    projected_completion_date: str | None
    on_track: bool


class SuggestedTask(BaseModel):
    title: str
    description: str | None
    deadline: str | None
    priority: str


class AIBreakdownResponse(BaseModel):
    goal_title: str
    tasks: list[SuggestedTask]


class DeleteResponse(BaseModel):
    detail: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _days_remaining(end_date: date) -> int:
    return max((end_date - date.today()).days, 0)


def _on_track(goal: Goal) -> str:
    today = date.today()
    if goal.status == "completed":
        return "completed"
    total = max((goal.end_date - goal.start_date).days, 1)
    elapsed = max((today - goal.start_date).days, 0)
    expected = min(elapsed / total * 100, 100)
    if goal.progress_percentage >= expected:
        return "on_track"
    if goal.progress_percentage >= expected * 0.7:
        return "slightly_behind"
    return "behind"


async def _get_milestones(
    goal_id: uuid.UUID, db: AsyncSession
) -> list[MilestoneResponse]:
    result = await db.execute(
        select(GoalMilestone)
        .where(GoalMilestone.goal_id == goal_id)
        .order_by(GoalMilestone.target_date.asc())
    )
    return [
        MilestoneResponse(
            id=m.id,
            title=m.title,
            target_date=m.target_date,
            is_completed=m.is_completed,
            completed_at=m.completed_at,
        )
        for m in result.scalars().all()
    ]


async def _goal_to_response(goal: Goal, db: AsyncSession) -> GoalResponse:
    milestones = await _get_milestones(goal.id, db)
    return GoalResponse(
        id=goal.id,
        title=goal.title,
        description=goal.description,
        goal_type=goal.goal_type,
        timeframe_days=goal.timeframe_days,
        start_date=goal.start_date,
        end_date=goal.end_date,
        progress_percentage=round(goal.progress_percentage, 1),
        status=goal.status,
        category=goal.category,
        days_remaining=_days_remaining(goal.end_date),
        on_track_status=_on_track(goal),
        milestones=milestones,
        created_at=goal.created_at,
    )


async def _get_user_goal(
    goal_id: uuid.UUID, user: User, db: AsyncSession
) -> Goal:
    result = await db.execute(
        select(Goal).where(and_(Goal.id == goal_id, Goal.user_id == user.id))
    )
    goal = result.scalar_one_or_none()
    if goal is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found")
    return goal


# ---------------------------------------------------------------------------
# 1. GET /goals
# ---------------------------------------------------------------------------

@router.get("", response_model=list[GoalResponse])
async def list_goals(
    goal_type: str = Query(default="all", pattern=r"^(short_term|long_term|all)$"),
    status_filter: str | None = Query(default=None, alias="status"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[GoalResponse]:
    stmt = select(Goal).where(Goal.user_id == user.id)

    if goal_type != "all":
        stmt = stmt.where(Goal.goal_type == goal_type)
    if status_filter:
        if status_filter not in ("active", "completed", "abandoned"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="status must be 'active', 'completed', or 'abandoned'",
            )
        stmt = stmt.where(Goal.status == status_filter)

    stmt = stmt.order_by(Goal.end_date.asc())
    result = await db.execute(stmt)
    goals = result.scalars().all()
    return [await _goal_to_response(g, db) for g in goals]


# ---------------------------------------------------------------------------
# 2. POST /goals
# ---------------------------------------------------------------------------

@router.post("", response_model=GoalResponse, status_code=status.HTTP_201_CREATED)
async def create_goal(
    body: GoalCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> GoalResponse:
    today = date.today()
    end = today + timedelta(days=body.timeframe_days)

    goal = Goal(
        user_id=user.id,
        title=body.title,
        description=body.description,
        goal_type=body.goal_type,
        timeframe_days=body.timeframe_days,
        start_date=today,
        end_date=end,
        progress_percentage=0.0,
        status="active",
        category=body.category,
    )
    db.add(goal)
    await db.flush()
    await db.refresh(goal)

    for m in body.milestones:
        milestone = GoalMilestone(
            goal_id=goal.id,
            title=m.title,
            target_date=m.target_date,
        )
        db.add(milestone)

    await db.flush()
    return await _goal_to_response(goal, db)


# ---------------------------------------------------------------------------
# 3. PATCH /goals/{goal_id}/progress
# ---------------------------------------------------------------------------

@router.patch("/{goal_id}/progress", response_model=GoalResponse)
async def update_progress(
    goal_id: uuid.UUID,
    body: ProgressUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> GoalResponse:
    goal = await _get_user_goal(goal_id, user, db)

    if goal.status != "active":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot update progress on a non-active goal",
        )

    goal.progress_percentage = body.progress_percentage
    if body.progress_percentage >= 100:
        goal.status = "completed"

    await db.flush()
    await db.refresh(goal)
    return await _goal_to_response(goal, db)


# ---------------------------------------------------------------------------
# 4. POST /goals/{goal_id}/milestones/{milestone_id}/complete
# ---------------------------------------------------------------------------

@router.post(
    "/{goal_id}/milestones/{milestone_id}/complete",
    response_model=GoalResponse,
)
async def complete_milestone(
    goal_id: uuid.UUID,
    milestone_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> GoalResponse:
    goal = await _get_user_goal(goal_id, user, db)

    result = await db.execute(
        select(GoalMilestone).where(
            and_(
                GoalMilestone.id == milestone_id,
                GoalMilestone.goal_id == goal.id,
            )
        )
    )
    milestone = result.scalar_one_or_none()
    if milestone is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Milestone not found",
        )

    if milestone.is_completed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Milestone already completed",
        )

    milestone.is_completed = True
    milestone.completed_at = datetime.now(timezone.utc)

    # Auto-update goal progress based on milestone completion ratio.
    all_milestones_result = await db.execute(
        select(GoalMilestone).where(GoalMilestone.goal_id == goal.id)
    )
    all_ms = all_milestones_result.scalars().all()
    if all_ms:
        done = sum(1 for m in all_ms if m.is_completed)
        goal.progress_percentage = round(done / len(all_ms) * 100, 1)
        if goal.progress_percentage >= 100:
            goal.status = "completed"

    await db.flush()
    await db.refresh(goal)
    return await _goal_to_response(goal, db)


# ---------------------------------------------------------------------------
# 5. GET /goals/{goal_id}/visual-data
# ---------------------------------------------------------------------------

@router.get("/{goal_id}/visual-data", response_model=VisualData)
async def visual_data(
    goal_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> VisualData:
    goal = await _get_user_goal(goal_id, user, db)
    today = date.today()

    # Build progress-over-time from milestones completed.
    milestones_result = await db.execute(
        select(GoalMilestone)
        .where(GoalMilestone.goal_id == goal.id)
        .order_by(GoalMilestone.target_date.asc())
    )
    all_ms = milestones_result.scalars().all()
    total_ms = len(all_ms) if all_ms else 1

    # Start at 0 on start_date, current progress on today.
    progress_over_time: list[ProgressPoint] = [
        ProgressPoint(date=goal.start_date.isoformat(), percentage=0.0),
    ]

    # Add a point each time a milestone was completed.
    completed_so_far = 0
    for m in sorted(all_ms, key=lambda x: x.completed_at or datetime.max.replace(tzinfo=timezone.utc)):
        if m.is_completed and m.completed_at:
            completed_so_far += 1
            pct = round(completed_so_far / total_ms * 100, 1)
            progress_over_time.append(
                ProgressPoint(
                    date=m.completed_at.date().isoformat(),
                    percentage=pct,
                )
            )

    progress_over_time.append(
        ProgressPoint(date=today.isoformat(), percentage=goal.progress_percentage)
    )

    milestone_markers = [
        MilestoneMarker(
            date=m.target_date.isoformat(),
            title=m.title,
            is_completed=m.is_completed,
        )
        for m in all_ms
    ]

    # Project completion date from current velocity.
    projected: str | None = None
    elapsed = max((today - goal.start_date).days, 1)
    if goal.progress_percentage > 0:
        days_for_100 = int(elapsed / goal.progress_percentage * 100)
        projected_date = goal.start_date + timedelta(days=days_for_100)
        projected = projected_date.isoformat()

    on_track = _on_track(goal) in ("on_track", "completed")

    return VisualData(
        progress_over_time=progress_over_time,
        milestone_markers=milestone_markers,
        projected_completion_date=projected,
        on_track=on_track,
    )


# ---------------------------------------------------------------------------
# 6. POST /goals/{goal_id}/ai-breakdown
# ---------------------------------------------------------------------------

_BREAKDOWN_SYSTEM = (
    "You break down a goal into concrete daily/weekly tasks. "
    "Return strict JSON: {\"tasks\": [{\"title\": str, \"description\": str or null, "
    "\"deadline\": \"YYYY-MM-DD\" or null, \"priority\": \"high\"|\"medium\"|\"low\"}]}. "
    "Be practical — each task should take 30-120 minutes."
)


@router.post("/{goal_id}/ai-breakdown", response_model=AIBreakdownResponse)
async def ai_breakdown(
    goal_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AIBreakdownResponse:
    goal = await _get_user_goal(goal_id, user, db)
    milestones = await _get_milestones(goal.id, db)

    milestone_text = "\n".join(
        f"  - {m.title} (target: {m.target_date}, done: {m.is_completed})"
        for m in milestones
    ) or "  (none)"

    completion = await openai_client.chat.completions.create(
        model=LLM_MODEL,
        response_format={"type": "json_object"},
        temperature=0.3,
        messages=[
            {"role": "system", "content": _BREAKDOWN_SYSTEM},
            {
                "role": "user",
                "content": (
                    f"Goal: {goal.title}\n"
                    f"Description: {goal.description or 'N/A'}\n"
                    f"Type: {goal.goal_type}\n"
                    f"Category: {goal.category}\n"
                    f"Start: {goal.start_date}, End: {goal.end_date}\n"
                    f"Current progress: {goal.progress_percentage}%\n"
                    f"Milestones:\n{milestone_text}\n\n"
                    f"Today is {date.today().isoformat()}. "
                    "Break this down into practical tasks."
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

    raw_tasks = data.get("tasks", [])
    tasks: list[SuggestedTask] = []
    for t in raw_tasks:
        if not isinstance(t, dict):
            continue
        pri = str(t.get("priority", "medium")).lower()
        if pri not in ("high", "medium", "low"):
            pri = "medium"
        tasks.append(
            SuggestedTask(
                title=str(t.get("title", "")),
                description=t.get("description"),
                deadline=t.get("deadline"),
                priority=pri,
            )
        )

    return AIBreakdownResponse(goal_title=goal.title, tasks=tasks)


# ---------------------------------------------------------------------------
# 7. POST /goals/{goal_id}/resume-bullet  — draft a resume line from a goal
# ---------------------------------------------------------------------------

class ResumeBulletResponse(BaseModel):
    bullet: str


@router.post("/{goal_id}/resume-bullet", response_model=ResumeBulletResponse)
async def resume_bullet(
    goal_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ResumeBulletResponse:
    goal = await _get_user_goal(goal_id, user, db)

    plain = f"Completed: {goal.title}" + (f" — {goal.description}" if goal.description else "")
    try:
        completion = await openai_client.chat.completions.create(
            model=LLM_MODEL,
            temperature=0.5,
            max_tokens=90,
            messages=[
                {"role": "system", "content": "Turn a completed goal into ONE polished, results-oriented resume bullet. Start with a strong action verb, quantify if possible, keep it to one line. Return only the bullet text, no quotes or leading dash."},
                {"role": "user", "content": f"Goal: {goal.title}\nDescription: {goal.description or 'N/A'}\nCategory: {goal.category}\nTimeframe: {goal.timeframe_days} days"},
            ],
        )
        bullet = (completion.choices[0].message.content or "").strip().lstrip("-• ").strip()
    except Exception:  # noqa: BLE001
        bullet = plain
    return ResumeBulletResponse(bullet=bullet or plain)
