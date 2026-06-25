from __future__ import annotations

import io
import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException, status
from pydantic import BaseModel
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.llm import genai_generate
from app.models import Bill, Goal, Meeting, Task


def _ensure_tz(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _parse_json(raw: str | None) -> dict[str, Any]:
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI returned an empty response",
        )
    # Strip markdown code fences that smaller models sometimes add.
    text = raw.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        # Remove opening fence (```json or ```) and closing fence
        text = "\n".join(
            lines[1:-1] if lines[-1].strip().startswith("```") else lines[1:]
        ).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"AI returned invalid JSON: {exc}",
        ) from exc


# ---------------------------------------------------------------------------
# Pydantic result models
# ---------------------------------------------------------------------------

class ScheduleBlock(BaseModel):
    time: str
    activity: str
    item_type: str | None = None  # "task" | "meeting" | "bill" | "break"


class DailyPlan(BaseModel):
    morning_blocks: list[ScheduleBlock]
    afternoon_blocks: list[ScheduleBlock]
    evening_blocks: list[ScheduleBlock]
    top_3_priorities: list[str]
    risk_items: list[str]
    motivational_message: str


class DeadlineItem(BaseModel):
    item: str
    date: str | None


class ActionStep(BaseModel):
    step: str
    deadline: str | None
    priority: str


class DocumentAnalysis(BaseModel):
    summary: str
    deadlines: list[DeadlineItem]
    action_plan: list[ActionStep]
    estimated_total_time_hours: float
    agent_prompt: str


class PrioritizedTask(BaseModel):
    task_id: uuid.UUID
    title: str
    priority_score: int  # 0-100
    reasoning: str


# ---------------------------------------------------------------------------
# 1. generate_daily_plan
# ---------------------------------------------------------------------------

_DAILY_PLAN_SYSTEM = (
    "You are a productivity assistant. Given a set of tasks, meetings, and bills, "
    "create an optimised daily schedule grouped by energy level "
    "(high-focus work in morning, meetings midday, admin in afternoon).\n"
    "Return ONLY valid JSON — no markdown fences, no text outside the object — "
    "matching this exact schema:\n"
    '{"morning_blocks":[{"time":string,"activity":string,"item_type":"task"|"meeting"|"bill"|"break"}],'
    '"afternoon_blocks":[{"time":string,"activity":string,"item_type":"task"|"meeting"|"bill"|"break"}],'
    '"evening_blocks":[{"time":string,"activity":string,"item_type":"task"|"meeting"|"bill"|"break"}],'
    '"top_3_priorities":[string,string,string],'
    '"risk_items":[string],'
    '"motivational_message":string}'
)


async def generate_daily_plan(user_id: uuid.UUID, db: AsyncSession) -> DailyPlan:
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    tomorrow_end = today_start + timedelta(days=2)

    # Tasks due today or tomorrow (not done).
    result = await db.execute(
        select(Task).where(
            and_(
                Task.user_id == user_id,
                Task.status != "done",
                Task.deadline.isnot(None),
                Task.deadline >= today_start,
                Task.deadline < tomorrow_end,
            )
        ).order_by(Task.deadline.asc())
    )
    tasks = result.scalars().all()

    # Meetings today.
    result = await db.execute(
        select(Meeting).where(
            and_(
                Meeting.user_id == user_id,
                Meeting.start_time >= today_start,
                Meeting.start_time < today_start + timedelta(days=1),
            )
        ).order_by(Meeting.start_time.asc())
    )
    meetings = result.scalars().all()

    # Bills due soon (next 7 days, unpaid).
    result = await db.execute(
        select(Bill).where(
            and_(
                Bill.user_id == user_id,
                Bill.status != "paid",
                Bill.due_date >= today_start,
                Bill.due_date < today_start + timedelta(days=7),
            )
        ).order_by(Bill.due_date.asc())
    )
    bills = result.scalars().all()

    payload = {
        "tasks": [
            {
                "title": t.title,
                "deadline": t.deadline.isoformat() if t.deadline else None,
                "priority": t.priority,
                "description": t.description or "",
            }
            for t in tasks
        ],
        "meetings": [
            {
                "title": m.title,
                "start": m.start_time.isoformat(),
                "end": m.end_time.isoformat(),
                "category": m.category,
            }
            for m in meetings
        ],
        "bills_due_soon": [
            {
                "name": b.name,
                "amount": float(b.amount),
                "currency": b.currency,
                "due_date": b.due_date.isoformat(),
            }
            for b in bills
        ],
    }

    user_content = (
        f"Today is {now.isoformat()}.\n"
        f"Here are my items:\n{json.dumps(payload, indent=2)}"
    )
    raw = await genai_generate(_DAILY_PLAN_SYSTEM, user_content, temperature=0.4)
    data = _parse_json(raw)

    def _blocks(key: str) -> list[ScheduleBlock]:
        return [
            ScheduleBlock(
                time=str(b.get("time", "")),
                activity=str(b.get("activity", "")),
                item_type=b.get("item_type"),
            )
            for b in data.get(key, [])
            if isinstance(b, dict)
        ]

    return DailyPlan(
        morning_blocks=_blocks("morning_blocks"),
        afternoon_blocks=_blocks("afternoon_blocks"),
        evening_blocks=_blocks("evening_blocks"),
        top_3_priorities=[str(p) for p in data.get("top_3_priorities", [])][:3],
        risk_items=[str(r) for r in data.get("risk_items", [])],
        motivational_message=str(data.get("motivational_message", "")),
    )


# ---------------------------------------------------------------------------
# 2. analyze_document
# ---------------------------------------------------------------------------

_DOC_ANALYSIS_SYSTEM = (
    "Read this document and extract all deadlines, action items, required "
    "decisions, and key dates. Create a step-by-step action plan.\n"
    "Return ONLY valid JSON — no markdown fences, no text outside the object — "
    "matching this exact schema:\n"
    '{"summary":string,'
    '"deadlines":[{"item":string,"date":"ISO-8601 or null"}],'
    '"action_plan":[{"step":string,"deadline":"ISO-8601 or null","priority":"high"|"medium"|"low"}],'
    '"estimated_total_time_hours":number,'
    '"agent_prompt":string}\n'
    "agent_prompt is a self-contained prompt the user can paste into an AI agent "
    "to automate these requirements. If no deadlines, use []. "
    "estimated_total_time_hours must be a number, never a string."
)

_PDF_EXTS = {".pdf"}
_DOCX_EXTS = {".docx", ".doc"}
_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}


def _ext(filename: str) -> str:
    idx = filename.rfind(".")
    return filename[idx:].lower() if idx != -1 else ""


def _extract_pdf_text(file_content: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(file_content))
    parts: list[str] = []
    for page in reader.pages:
        parts.append(page.extract_text() or "")
    return "\n".join(parts).strip()


def _extract_docx_text(file_content: bytes) -> str:
    import docx

    document = docx.Document(io.BytesIO(file_content))
    return "\n".join(p.text for p in document.paragraphs).strip()


def _image_mime(ext: str) -> str:
    if ext in (".jpg", ".jpeg"):
        return "image/jpeg"
    if ext == ".png":
        return "image/png"
    if ext == ".gif":
        return "image/gif"
    if ext == ".webp":
        return "image/webp"
    return "application/octet-stream"


def _parse_document_analysis(data: dict[str, Any]) -> DocumentAnalysis:
    deadlines = [
        DeadlineItem(item=str(d.get("item", "")), date=d.get("date"))
        for d in data.get("deadlines", [])
        if isinstance(d, dict)
    ]
    action_plan = [
        ActionStep(
            step=str(s.get("step", "")),
            deadline=s.get("deadline"),
            priority=str(s.get("priority", "medium")),
        )
        for s in data.get("action_plan", [])
        if isinstance(s, dict)
    ]
    try:
        est = float(data.get("estimated_total_time_hours", 0) or 0)
    except (TypeError, ValueError):
        est = 0.0

    return DocumentAnalysis(
        summary=str(data.get("summary", "")),
        deadlines=deadlines,
        action_plan=action_plan,
        estimated_total_time_hours=est,
        agent_prompt=str(data.get("agent_prompt", "")),
    )


async def analyze_document(
    file_content: bytes, filename: str, user_context: str
) -> DocumentAnalysis:
    ext = _ext(filename)

    if ext in _IMAGE_EXTS:
        # Vision path — native Gemini multimodal (supports raw bytes directly).
        image_part = {"mime_type": _image_mime(ext), "data": file_content}
        user_text = f"User context: {user_context}\n\nAnalyze this document image."
        raw = await genai_generate(
            _DOC_ANALYSIS_SYSTEM, [user_text, image_part], temperature=0.2
        )
        data = _parse_json(raw)
        return _parse_document_analysis(data)

    if ext in _PDF_EXTS:
        # Fast path: pull the text layer if the PDF has one.
        try:
            text = _extract_pdf_text(file_content)
        except Exception:  # noqa: BLE001 — corrupt/encrypted PDF, fall back to vision
            text = ""

        # Scanned / image-only PDFs have no extractable text. Send the raw PDF
        # to Gemini, which OCRs it natively. This is the "scanning" path.
        if len(text.strip()) < 30:
            pdf_part = {"mime_type": "application/pdf", "data": file_content}
            user_text = (
                f"User context: {user_context}\n\n"
                "Analyze this document (it may be a scan — read the text in the images)."
            )
            raw = await genai_generate(
                _DOC_ANALYSIS_SYSTEM, [user_text, pdf_part], temperature=0.2
            )
            data = _parse_json(raw)
            return _parse_document_analysis(data)
        # else: usable text layer — continue to the shared text path below.

    elif ext in _DOCX_EXTS:
        text = _extract_docx_text(file_content)
    else:
        # Fall back to treating it as plain UTF-8 text.
        try:
            text = file_content.decode("utf-8", errors="ignore").strip()
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail=f"Unsupported file type: {ext}",
            ) from exc

    if not text:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Could not extract any text from the document",
        )

    # Cap extremely long docs to keep token usage reasonable.
    text = text[:60000]

    from app.security_utils import wrap_untrusted
    user_content = (
        f"User context: {user_context}\n\n"
        f"Document ({filename}) content:\n{wrap_untrusted(text)}"
    )
    raw = await genai_generate(_DOC_ANALYSIS_SYSTEM, user_content, temperature=0.2)
    data = _parse_json(raw)
    return _parse_document_analysis(data)


# ---------------------------------------------------------------------------
# 3. prioritize_tasks
# ---------------------------------------------------------------------------

_PRIORITIZE_SYSTEM = (
    "You are a productivity assistant. Given a list of tasks with titles, "
    "deadlines, and descriptions, assign each a priority_score 0-100 "
    "(100 = most urgent/important) and a one-sentence reasoning.\n"
    "Return ONLY valid JSON — no markdown fences, no text outside the object — "
    "matching this exact schema:\n"
    '{"tasks":[{"task_id":string,"priority_score":integer,"reasoning":string}]}\n'
    "Do not add extra fields. Do not include any text outside the JSON object."
)


async def prioritize_tasks(tasks: list[Task]) -> list[PrioritizedTask]:
    if not tasks:
        return []

    now = datetime.now(timezone.utc)
    payload = [
        {
            "task_id": str(t.id),
            "title": t.title,
            "deadline": t.deadline.isoformat() if t.deadline else None,
            "description": t.description or "",
            "current_priority": t.priority,
        }
        for t in tasks
    ]

    user_content = (
        f"Today is {now.isoformat()}.\n"
        f"Tasks:\n{json.dumps(payload, indent=2)}"
    )
    raw = await genai_generate(_PRIORITIZE_SYSTEM, user_content, temperature=0.0)
    data = _parse_json(raw)
    raw_items = data.get("tasks", data if isinstance(data, list) else [])

    title_by_id = {str(t.id): t.title for t in tasks}
    valid_ids = set(title_by_id)

    results: list[PrioritizedTask] = []
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        tid = str(item.get("task_id", ""))
        if tid not in valid_ids:
            continue
        try:
            score = int(round(float(item.get("priority_score", 50))))
        except (TypeError, ValueError):
            score = 50
        score = max(0, min(100, score))
        results.append(
            PrioritizedTask(
                task_id=uuid.UUID(tid),
                title=title_by_id[tid],
                priority_score=score,
                reasoning=str(item.get("reasoning", "")),
            )
        )

    results.sort(key=lambda p: p.priority_score, reverse=True)
    return results


# ---------------------------------------------------------------------------
# 4. generate_agent_prompt
# ---------------------------------------------------------------------------

async def _collect_user_context(
    user_id: uuid.UUID, db: AsyncSession
) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    horizon = now + timedelta(days=14)

    result = await db.execute(
        select(Task).where(
            and_(Task.user_id == user_id, Task.status != "done")
        ).order_by(Task.deadline.asc().nulls_last())
    )
    tasks = result.scalars().all()

    result = await db.execute(
        select(Meeting).where(
            and_(
                Meeting.user_id == user_id,
                Meeting.start_time >= now,
                Meeting.start_time <= horizon,
            )
        ).order_by(Meeting.start_time.asc())
    )
    meetings = result.scalars().all()

    result = await db.execute(
        select(Bill).where(
            and_(Bill.user_id == user_id, Bill.status != "paid")
        ).order_by(Bill.due_date.asc())
    )
    bills = result.scalars().all()

    result = await db.execute(
        select(Goal).where(
            and_(Goal.user_id == user_id, Goal.status == "active")
        )
    )
    goals = result.scalars().all()

    return {
        "now": now.isoformat(),
        "tasks": [
            {
                "title": t.title,
                "deadline": t.deadline.isoformat() if t.deadline else None,
                "priority": t.priority,
                "status": t.status,
            }
            for t in tasks
        ],
        "meetings": [
            {
                "title": m.title,
                "start": m.start_time.isoformat(),
                "end": m.end_time.isoformat(),
            }
            for m in meetings
        ],
        "bills": [
            {
                "name": b.name,
                "amount": float(b.amount),
                "due_date": b.due_date.isoformat(),
            }
            for b in bills
        ],
        "goals": [
            {
                "title": g.title,
                "target_date": g.target_date.isoformat() if g.target_date else None,
                "progress": g.progress,
            }
            for g in goals
        ],
    }


_AGENT_PROMPT_SYSTEM = (
    "You generate a comprehensive, self-contained prompt that the user can "
    "paste into an external automation AI agent (Antigravity, n8n, Make.com, "
    "Zapier) to help automate their productivity actions. "
    "The prompt you write should: clearly state the user's current priorities, "
    "list blocked tasks and why, identify calendar gaps suitable for focused "
    "work blocks, and give the agent concrete, actionable instructions. "
    "Return ONLY the prompt text, no preamble or JSON."
)


async def generate_agent_prompt(user_id: uuid.UUID, db: AsyncSession) -> str:
    context = await _collect_user_context(user_id, db)

    user_content = (
        "Here is my full productivity context as JSON:\n"
        f"{json.dumps(context, indent=2)}\n\n"
        "Generate the agent prompt."
    )
    raw = await genai_generate(
        _AGENT_PROMPT_SYSTEM, user_content, temperature=0.5, json_mode=False
    )
    return raw.strip()


# ---------------------------------------------------------------------------
# 5. smart_categorize_meeting
# ---------------------------------------------------------------------------

_CATEGORIZE_SYSTEM = (
    "Classify the meeting as exactly 'personal' or 'professional' based on its "
    "title, description, and attendees. Reply with only one word: "
    "'personal' or 'professional'."
)


async def smart_categorize_meeting(event: dict[str, Any]) -> str:
    attendees = event.get("attendees", [])
    attendee_emails = [
        a.get("email", "") for a in attendees if isinstance(a, dict)
    ]
    summary = event.get("summary", "")
    description = event.get("description", "")

    user_content = (
        f"Title: {summary}\n"
        f"Description: {description}\n"
        f"Attendees ({len(attendee_emails)}): "
        f"{', '.join(attendee_emails)}"
    )
    answer = (
        await genai_generate(
            _CATEGORIZE_SYSTEM,
            user_content,
            temperature=0,
            json_mode=False,
            max_output_tokens=50,
        )
    ).strip().lower()
    return "professional" if "professional" in answer else "personal"
