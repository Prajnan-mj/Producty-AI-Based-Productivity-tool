from __future__ import annotations

import json
from collections.abc import AsyncIterator
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache import safe_get, safe_set
from app.database import get_db
from app.openai_client import openai_client, LLM_MODEL
from app.models import Goal, Meeting, Task, User
from app.security import get_current_user
from app.services import ai_service
from app.services.ai_service import DailyPlan, PrioritizedTask

router = APIRouter()

DAILY_PLAN_TTL_SECONDS = 30 * 60  # 30 minutes


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class PrioritizeResponse(BaseModel):
    suggestions: list[PrioritizedTask]


class AgentPromptResponse(BaseModel):
    prompt: str
    generated_at: str


class ChatMessage(BaseModel):
    role: str = Field(..., pattern=r"^(system|user|assistant)$")
    content: str


class ChatRequest(BaseModel):
    message: str
    context_window: list[ChatMessage] = Field(default_factory=list)


class FocusResponse(BaseModel):
    task_title: str | None
    message: str


# ---------------------------------------------------------------------------
# 1. GET /ai/daily-plan  (Redis-cached 30 min)
# ---------------------------------------------------------------------------

@router.get("/daily-plan", response_model=DailyPlan)
async def daily_plan(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DailyPlan:
    today = datetime.now(timezone.utc).date().isoformat()
    cache_key = f"daily_plan:{user.id}:{today}"

    cached = await safe_get(cache_key)
    if cached:
        return DailyPlan.model_validate_json(cached)

    plan = await ai_service.generate_daily_plan(user.id, db)
    await safe_set(cache_key, plan.model_dump_json(), DAILY_PLAN_TTL_SECONDS)
    return plan


# ---------------------------------------------------------------------------
# 2. POST /ai/prioritize-now  (review-only)
# ---------------------------------------------------------------------------

@router.post("/prioritize-now", response_model=PrioritizeResponse)
async def prioritize_now(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PrioritizeResponse:
    result = await db.execute(
        select(Task).where(
            and_(Task.user_id == user.id, Task.status == "pending")
        )
    )
    tasks = list(result.scalars().all())
    suggestions = await ai_service.prioritize_tasks(tasks)
    return PrioritizeResponse(suggestions=suggestions)


# ---------------------------------------------------------------------------
# 3. GET /ai/agent-prompt
# ---------------------------------------------------------------------------

@router.get("/agent-prompt", response_model=AgentPromptResponse)
async def agent_prompt(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AgentPromptResponse:
    prompt = await ai_service.generate_agent_prompt(user.id, db)
    return AgentPromptResponse(
        prompt=prompt,
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


# ---------------------------------------------------------------------------
# 3b. GET /ai/focus  — what to do in the next focus session
# ---------------------------------------------------------------------------

@router.get("/focus", response_model=FocusResponse)
async def focus_suggestion(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> FocusResponse:
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(Task).where(
            and_(Task.user_id == user.id, Task.status != "done")
        ).order_by(Task.deadline.asc().nulls_last()).limit(8)
    )
    tasks = result.scalars().all()
    if not tasks:
        return FocusResponse(task_title=None, message="Nothing on your plate — pick something you want to move forward.")

    top = tasks[0]
    lines = "\n".join(
        f"- {t.title} (due {t.deadline.isoformat() if t.deadline else 'no deadline'}, {t.priority})"
        for t in tasks
    )
    try:
        completion = await openai_client.chat.completions.create(
            model=LLM_MODEL,
            temperature=0.4,
            max_tokens=80,
            messages=[
                {"role": "system", "content": "You are a focus coach. In ONE short sentence, tell the user the single most important thing to work on for the next 25 minutes and to ignore the rest. Be direct."},
                {"role": "user", "content": f"Now: {now.isoformat()}\nOpen tasks:\n{lines}"},
            ],
        )
        msg = (completion.choices[0].message.content or "").strip()
    except Exception:  # noqa: BLE001 — degrade to the nearest deadline
        msg = f"Focus only on “{top.title}” for the next 25 minutes. Ignore everything else."

    return FocusResponse(task_title=top.title, message=msg or f"Focus on “{top.title}”.")


# ---------------------------------------------------------------------------
# 4. POST /ai/chat  (SSE streaming)
# ---------------------------------------------------------------------------

async def _build_chat_system_prompt(user: User, db: AsyncSession) -> str:
    now = datetime.now(timezone.utc)

    result = await db.execute(
        select(Task).where(
            and_(Task.user_id == user.id, Task.status != "done")
        ).order_by(Task.deadline.asc().nulls_last()).limit(25)
    )
    tasks = result.scalars().all()

    result = await db.execute(
        select(Meeting).where(
            and_(Meeting.user_id == user.id, Meeting.start_time >= now)
        ).order_by(Meeting.start_time.asc()).limit(15)
    )
    meetings = result.scalars().all()

    result = await db.execute(
        select(Goal).where(
            and_(Goal.user_id == user.id, Goal.status == "active")
        )
    )
    goals = result.scalars().all()

    task_lines = "\n".join(
        f"- {t.title} (priority={t.priority}, "
        f"deadline={t.deadline.isoformat() if t.deadline else 'none'})"
        for t in tasks
    ) or "  (none)"
    meeting_lines = "\n".join(
        f"- {m.title} at {m.start_time.isoformat()}" for m in meetings
    ) or "  (none)"
    goal_lines = "\n".join(
        f"- {g.title} ({g.progress}% complete)" for g in goals
    ) or "  (none)"

    return (
        "You are a helpful productivity assistant embedded in the user's "
        f"planning app. The current time is {now.isoformat()}.\n\n"
        f"The user's name is {user.name or 'there'}.\n\n"
        f"Current open tasks:\n{task_lines}\n\n"
        f"Upcoming meetings:\n{meeting_lines}\n\n"
        f"Active goals:\n{goal_lines}\n\n"
        "RESPONSE RULES:\n"
        "- Keep every answer under 100 words unless the user explicitly asks "
        "for more detail, a long explanation, or a list.\n"
        "- Be direct. No filler, no preamble, no restating the question.\n"
        "- Use short sentences and bullet points.\n"
        "- Be practical and encouraging.\n"
    )


@router.post("/chat")
async def chat(
    body: ChatRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    system_prompt = await _build_chat_system_prompt(user, db)

    messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]
    for m in body.context_window:
        messages.append({"role": m.role, "content": m.content})
    messages.append({"role": "user", "content": body.message})

    async def event_generator() -> AsyncIterator[str]:
        try:
            stream = await openai_client.chat.completions.create(
                model=LLM_MODEL,
                messages=messages,  # type: ignore[arg-type]
                temperature=0.6,
                stream=True,
            )
            async for chunk in stream:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta.content
                if delta:
                    yield f"data: {json.dumps({'content': delta})}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as exc:  # noqa: BLE001
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
