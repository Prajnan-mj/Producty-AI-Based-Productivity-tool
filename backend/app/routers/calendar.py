from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from pydantic import BaseModel
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.llm import genai_generate
from app.models import Meeting, Note, Task, User
from app.security import get_current_user

router = APIRouter()

GOOGLE_SCOPES: list[str] = [
    "https://www.googleapis.com/auth/calendar",
]

WORK_KEYWORDS: set[str] = {
    "standup", "sprint", "retro", "retrospective", "planning", "review",
    "sync", "1:1", "one-on-one", "scrum", "kanban", "jira", "roadmap",
    "stakeholder", "kickoff", "kick-off", "all-hands", "townhall",
    "quarterly", "budget", "revenue", "pipeline", "client", "vendor",
    "onboarding", "interview", "candidate", "offer", "performance",
    "okr", "kpi", "deliverable", "milestone", "project", "deployment",
}

DEADLINE_KEYWORDS: set[str] = {"deadline", "due", "submit", "submission", "due date"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_google_credentials(user: User) -> Credentials:
    if not user.google_access_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Google account not connected — please login via /api/auth/google/login",
        )
    creds = Credentials(
        token=user.google_access_token,
        refresh_token=user.google_refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
        scopes=GOOGLE_SCOPES,
    )
    if creds.expired and creds.refresh_token:
        creds.refresh(GoogleRequest())
    return creds


async def _persist_refreshed_token(
    creds: Credentials, user: User, db: AsyncSession
) -> None:
    """Write back the refreshed Google token so the next call reuses it."""
    if creds.token != user.google_access_token:
        user.google_access_token = creds.token
        expiry = creds.expiry
        if expiry is not None and expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=timezone.utc)
        user.google_token_expiry = expiry
        await db.flush()


def _build_calendar_service(creds: Credentials) -> Any:
    return build("calendar", "v3", credentials=creds, cache_discovery=False)


def classify_meeting(event: dict[str, Any]) -> str:
    attendees: list[dict[str, Any]] = event.get("attendees", [])
    if len(attendees) > 2:
        return "professional"

    text = (
        (event.get("summary", "") + " " + event.get("description", ""))
        .lower()
    )
    for keyword in WORK_KEYWORDS:
        if keyword in text:
            return "professional"

    return "personal"


def _is_deadline_event(event: dict[str, Any]) -> bool:
    text = (
        (event.get("summary", "") + " " + event.get("description", ""))
        .lower()
    )
    return any(kw in text for kw in DEADLINE_KEYWORDS)


def _parse_gcal_datetime(dt_obj: dict[str, Any]) -> datetime:
    raw = dt_obj.get("dateTime") or dt_obj.get("date", "")
    if "T" in raw:
        return datetime.fromisoformat(raw)
    return datetime.fromisoformat(raw + "T00:00:00+00:00")


def _extract_meet_link(event: dict[str, Any]) -> str | None:
    ep = event.get("conferenceData", {}).get("entryPoints", [])
    for entry in ep:
        if entry.get("entryPointType") == "video":
            return entry.get("uri")

    desc = event.get("description", "")
    match = re.search(r"https://meet\.google\.com/[a-z\-]+", desc)
    return match.group(0) if match else None


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class CategoryEnum(str, Enum):
    personal = "personal"
    professional = "professional"
    all = "all"


class MeetingResponse(BaseModel):
    id: str
    title: str
    start: datetime
    end: datetime
    category: str
    attendees: int
    description: str | None
    meet_link: str | None


class CategorizeRequest(BaseModel):
    category: str


class DeadlineResponse(BaseModel):
    id: str
    title: str
    start: datetime
    end: datetime
    description: str | None
    days_remaining: int
    meet_link: str | None


class SyncSummary(BaseModel):
    synced: int
    new: int
    updated: int


# ---------------------------------------------------------------------------
# 0. GET /debug — diagnose why calendar/gmail isn't syncing
# ---------------------------------------------------------------------------

@router.get("/debug")
async def calendar_debug(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Surfaces the real error behind a failing calendar read."""
    out: dict[str, Any] = {
        "has_access_token": bool(user.google_access_token),
        "has_refresh_token": bool(user.google_refresh_token),
        "token_expiry": user.google_token_expiry.isoformat() if user.google_token_expiry else None,
    }

    if not user.google_access_token:
        out["error"] = "No Google token stored. Sign out and sign in again."
        return out

    # Check which scopes the token actually has (via Google's tokeninfo).
    try:
        import httpx
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                "https://www.googleapis.com/oauth2/v1/tokeninfo",
                params={"access_token": user.google_access_token},
            )
        if resp.status_code == 200:
            info = resp.json()
            out["granted_scopes"] = info.get("scope", "")
            out["has_calendar_scope"] = "calendar" in info.get("scope", "")
        else:
            out["tokeninfo_status"] = resp.status_code
    except Exception as exc:  # noqa: BLE001
        out["tokeninfo_error"] = str(exc)

    # List ALL calendars and scan each one for events (past 7d → next 60d).
    try:
        creds = _get_google_credentials(user)
        await _persist_refreshed_token(creds, user, db)
        service = _build_calendar_service(creds)
        now = datetime.now(timezone.utc)
        time_min = (now - timedelta(days=7)).isoformat()
        time_max = (now + timedelta(days=60)).isoformat()

        cal_list = service.calendarList().list().execute()
        calendars = cal_list.get("items", [])
        out["calendars"] = []

        for cal in calendars:
            cal_id = cal["id"]
            try:
                ev_res = (
                    service.events()
                    .list(
                        calendarId=cal_id,
                        timeMin=time_min,
                        timeMax=time_max,
                        singleEvents=True,
                        orderBy="startTime",
                        maxResults=20,
                    )
                    .execute()
                )
                events = ev_res.get("items", [])
            except Exception as exc:  # noqa: BLE001
                out["calendars"].append({"id": cal_id, "error": str(exc)})
                continue

            out["calendars"].append({
                "id": cal_id,
                "summary": cal.get("summary"),
                "primary": cal.get("primary", False),
                "events_found": len(events),
                "sample": [
                    {"title": e.get("summary"), "start": e.get("start")}
                    for e in events[:5]
                ],
            })

        out["calendar_read_ok"] = True
    except Exception as exc:  # noqa: BLE001
        out["calendar_read_ok"] = False
        out["calendar_error"] = f"{type(exc).__name__}: {exc}"

    return out


# ---------------------------------------------------------------------------
# 1. GET /meetings
# ---------------------------------------------------------------------------

@router.get("/meetings", response_model=list[MeetingResponse])
async def list_meetings(
    start_date: str = Query(..., description="ISO8601 date, e.g. 2026-06-01T00:00:00Z"),
    end_date: str = Query(..., description="ISO8601 date, e.g. 2026-06-30T23:59:59Z"),
    category: CategoryEnum = Query(default=CategoryEnum.all),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[MeetingResponse]:
    items: list[dict[str, Any]] = []

    # Try to pull Google events, but don't fail the whole request if Google
    # isn't connected or errors — we still return locally-stored meetings.
    if user.google_access_token:
        try:
            creds = _get_google_credentials(user)
            service = _build_calendar_service(creds)
            await _persist_refreshed_token(creds, user, db)
            events_result = (
                service.events()
                .list(
                    calendarId="primary",
                    timeMin=start_date,
                    timeMax=end_date,
                    singleEvents=True,
                    orderBy="startTime",
                    maxResults=250,
                )
                .execute()
            )
            items = events_result.get("items", [])
        except Exception:  # noqa: BLE001
            items = []

    # Category overrides for Google events.
    event_ids = [ev["id"] for ev in items]
    overrides: dict[str, str] = {}
    if event_ids:
        result = await db.execute(
            select(Meeting.google_event_id, Meeting.category).where(
                and_(
                    Meeting.user_id == user.id,
                    Meeting.google_event_id.in_(event_ids),
                    Meeting.category != "uncategorized",
                )
            )
        )
        overrides = {row[0]: row[1] for row in result.all()}

    meetings: list[MeetingResponse] = []
    seen_ids: set[str] = set()
    for ev in items:
        seen_ids.add(ev["id"])
        cat = overrides.get(ev["id"], classify_meeting(ev))
        if category != CategoryEnum.all and cat != category.value:
            continue
        meetings.append(
            MeetingResponse(
                id=ev["id"],
                title=ev.get("summary", "(No title)"),
                start=_parse_gcal_datetime(ev.get("start", {})),
                end=_parse_gcal_datetime(ev.get("end", {})),
                category=cat,
                attendees=len(ev.get("attendees", [])),
                description=ev.get("description"),
                meet_link=_extract_meet_link(ev),
            )
        )

    # Merge in locally-stored meetings (manual + previously synced) in range.
    start_dt = _parse_gcal_datetime({"dateTime": start_date})
    end_dt = _parse_gcal_datetime({"dateTime": end_date})
    db_result = await db.execute(
        select(Meeting).where(
            and_(
                Meeting.user_id == user.id,
                Meeting.start_time >= start_dt,
                Meeting.start_time <= end_dt,
            )
        )
    )
    for m in db_result.scalars().all():
        if m.google_event_id in seen_ids:
            continue  # already represented by the live Google event
        if category != CategoryEnum.all and m.category != category.value:
            continue
        meetings.append(
            MeetingResponse(
                id=m.google_event_id,
                title=m.title,
                start=m.start_time,
                end=m.end_time,
                category=m.category if m.category != "uncategorized" else "personal",
                attendees=m.attendee_count,
                description=m.description,
                meet_link=m.meet_link,
            )
        )

    meetings.sort(key=lambda x: x.start)
    return meetings


class ManualMeetingRequest(BaseModel):
    title: str
    start_time: datetime
    end_time: datetime
    category: str = "personal"
    description: str | None = None
    meet_link: str | None = None


@router.post("/meetings", response_model=MeetingResponse, status_code=status.HTTP_201_CREATED)
async def create_manual_meeting(
    body: ManualMeetingRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MeetingResponse:
    category = body.category if body.category in ("personal", "professional") else "personal"
    meeting = Meeting(
        user_id=user.id,
        google_event_id=f"manual_{uuid.uuid4()}",
        title=body.title,
        start_time=body.start_time,
        end_time=body.end_time,
        category=category,
        is_deadline=False,
        description=body.description,
        meet_link=body.meet_link,
        attendee_count=0,
    )
    db.add(meeting)
    await db.flush()
    await db.refresh(meeting)
    return MeetingResponse(
        id=meeting.google_event_id,
        title=meeting.title,
        start=meeting.start_time,
        end=meeting.end_time,
        category=meeting.category,
        attendees=0,
        description=meeting.description,
        meet_link=meeting.meet_link,
    )


# ---------------------------------------------------------------------------
# 1b. POST /calendar/events — push a task as a calendar block to Google
# ---------------------------------------------------------------------------

class PushEventRequest(BaseModel):
    task_id: str
    start_time: datetime
    end_time: datetime
    description: str | None = None


class PushEventResponse(BaseModel):
    google_event_id: str
    html_link: str | None = None


@router.post("/events", response_model=PushEventResponse)
async def push_to_google_calendar(
    body: PushEventRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PushEventResponse:
    """Push a local task as a calendar block to Google Calendar."""
    task = (
        await db.execute(
            select(Task).where(and_(Task.id == uuid.UUID(body.task_id), Task.user_id == user.id))
        )
    ).scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")

    if not user.google_access_token:
        raise HTTPException(status_code=401, detail="Google Calendar not connected")

    creds = _get_google_credentials(user)
    service = _build_calendar_service(creds)
    await _persist_refreshed_token(creds, user, db)

    event_body = {
        "summary": task.title,
        "description": body.description or task.description or f"Task: {task.title}",
        "start": {"dateTime": body.start_time.isoformat(), "timeZone": "UTC"},
        "end": {"dateTime": body.end_time.isoformat(), "timeZone": "UTC"},
    }

    try:
        result = service.events().insert(calendarId="primary", body=event_body).execute()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Google Calendar error: {exc}") from exc

    google_id = result.get("id", "")
    # Save locally too
    meeting = Meeting(
        user_id=user.id, google_event_id=google_id,
        title=task.title, start_time=body.start_time, end_time=body.end_time,
        category="professional", description=body.description or task.description,
        attendee_count=0,
    )
    db.add(meeting)
    await db.flush()

    return PushEventResponse(
        google_event_id=google_id,
        html_link=result.get("htmlLink"),
    )


# ---------------------------------------------------------------------------
# 2. POST /meetings/{event_id}/categorize
# ---------------------------------------------------------------------------

@router.post("/meetings/{event_id}/categorize", response_model=MeetingResponse)
async def categorize_meeting(
    event_id: str,
    body: CategorizeRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MeetingResponse:
    if body.category not in ("personal", "professional"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="category must be 'personal' or 'professional'",
        )

    result = await db.execute(
        select(Meeting).where(
            and_(
                Meeting.user_id == user.id,
                Meeting.google_event_id == event_id,
            )
        )
    )
    meeting = result.scalar_one_or_none()

    if meeting is None:
        # Fetch from Google so we can store a full row.
        creds = _get_google_credentials(user)
        service = _build_calendar_service(creds)
        await _persist_refreshed_token(creds, user, db)

        try:
            ev = service.events().get(calendarId="primary", eventId=event_id).execute()
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Event not found in Google Calendar: {exc}",
            ) from exc

        meeting = Meeting(
            user_id=user.id,
            google_event_id=event_id,
            title=ev.get("summary", "(No title)"),
            start_time=_parse_gcal_datetime(ev.get("start", {})),
            end_time=_parse_gcal_datetime(ev.get("end", {})),
            category=body.category,
            is_deadline=_is_deadline_event(ev),
            description=ev.get("description"),
            meet_link=_extract_meet_link(ev),
            attendee_count=len(ev.get("attendees", [])),
        )
        db.add(meeting)
    else:
        meeting.category = body.category

    await db.flush()
    await db.refresh(meeting)

    return MeetingResponse(
        id=meeting.google_event_id,
        title=meeting.title,
        start=meeting.start_time,
        end=meeting.end_time,
        category=meeting.category,
        attendees=meeting.attendee_count,
        description=meeting.description,
        meet_link=meeting.meet_link,
    )


# ---------------------------------------------------------------------------
# 3. GET /deadlines
# ---------------------------------------------------------------------------

@router.get("/deadlines", response_model=list[DeadlineResponse])
async def list_deadlines(
    from_date: str = Query(..., description="ISO8601 date"),
    sort_by: str = Query(default="deadline", description="'deadline' or 'priority'"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[DeadlineResponse]:
    creds = _get_google_credentials(user)
    service = _build_calendar_service(creds)
    await _persist_refreshed_token(creds, user, db)

    events_result = (
        service.events()
        .list(
            calendarId="primary",
            timeMin=from_date,
            singleEvents=True,
            orderBy="startTime",
            maxResults=500,
        )
        .execute()
    )

    now = datetime.now(timezone.utc)
    deadlines: list[DeadlineResponse] = []

    for ev in events_result.get("items", []):
        if not _is_deadline_event(ev):
            continue

        end_dt = _parse_gcal_datetime(ev.get("end", ev.get("start", {})))
        if end_dt.tzinfo is None:
            end_dt = end_dt.replace(tzinfo=timezone.utc)
        days_remaining = max((end_dt - now).days, 0)

        deadlines.append(
            DeadlineResponse(
                id=ev["id"],
                title=ev.get("summary", "(No title)"),
                start=_parse_gcal_datetime(ev.get("start", {})),
                end=end_dt,
                description=ev.get("description"),
                days_remaining=days_remaining,
                meet_link=_extract_meet_link(ev),
            )
        )

    if sort_by == "priority":
        deadlines.sort(key=lambda d: d.days_remaining)
    else:
        deadlines.sort(key=lambda d: d.start)

    return deadlines


# ---------------------------------------------------------------------------
# 4. POST /sync
# ---------------------------------------------------------------------------

@router.post("/sync", response_model=SyncSummary)
async def sync_calendar(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SyncSummary:
    creds = _get_google_credentials(user)
    service = _build_calendar_service(creds)
    await _persist_refreshed_token(creds, user, db)

    now = datetime.now(timezone.utc)
    time_min = now.isoformat()
    time_max = (now + timedelta(days=30)).isoformat()

    all_events: list[dict[str, Any]] = []
    page_token: str | None = None

    while True:
        events_result = (
            service.events()
            .list(
                calendarId="primary",
                timeMin=time_min,
                timeMax=time_max,
                singleEvents=True,
                orderBy="startTime",
                maxResults=250,
                pageToken=page_token,
            )
            .execute()
        )
        all_events.extend(events_result.get("items", []))
        page_token = events_result.get("nextPageToken")
        if not page_token:
            break

    new_count = 0
    updated_count = 0

    for ev in all_events:
        google_id: str = ev["id"]
        result = await db.execute(
            select(Meeting).where(
                and_(
                    Meeting.user_id == user.id,
                    Meeting.google_event_id == google_id,
                )
            )
        )
        existing = result.scalar_one_or_none()

        title = ev.get("summary", "(No title)")
        start_time = _parse_gcal_datetime(ev.get("start", {}))
        end_time = _parse_gcal_datetime(ev.get("end", {}))
        description = ev.get("description")
        meet_link = _extract_meet_link(ev)
        attendee_count = len(ev.get("attendees", []))
        is_deadline = _is_deadline_event(ev)

        if existing is None:
            meeting = Meeting(
                user_id=user.id,
                google_event_id=google_id,
                title=title,
                start_time=start_time,
                end_time=end_time,
                category=classify_meeting(ev),
                is_deadline=is_deadline,
                description=description,
                meet_link=meet_link,
                attendee_count=attendee_count,
            )
            db.add(meeting)
            new_count += 1
        else:
            existing.title = title
            existing.start_time = start_time
            existing.end_time = end_time
            existing.is_deadline = is_deadline
            existing.description = description
            existing.meet_link = meet_link
            existing.attendee_count = attendee_count
            # Only re-classify if user hasn't manually categorized.
            if existing.category == "uncategorized":
                existing.category = classify_meeting(ev)
            updated_count += 1

    await db.flush()

    return SyncSummary(
        synced=len(all_events),
        new=new_count,
        updated=updated_count,
    )


# ---------------------------------------------------------------------------
# Feature 5: Meeting Prep Autopilot
# ---------------------------------------------------------------------------

class PrepBrief(BaseModel):
    meeting_id: str
    meeting_title: str
    starts_in_minutes: int
    brief: str
    unresolved_actions: list[str]
    discussion_questions: list[str]
    relevant_deadlines: list[str]


_PREP_SYSTEM = (
    "Generate a 5-line prep brief for an upcoming meeting:\n"
    "1. Unresolved action items from last time (if any context provided)\n"
    "2-3. Two suggested discussion questions based on the agenda/notes\n"
    "4. Any deadline relevant to this meeting's topic\n"
    "5. One-sentence prep recommendation\n\n"
    'Return JSON: {"brief": "...", "unresolved_actions": [...], '
    '"discussion_questions": [...], "relevant_deadlines": [...]}'
)


@router.get("/meetings/{meeting_id}/prep", response_model=PrepBrief)
async def meeting_prep(
    meeting_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PrepBrief:
    meeting = (
        await db.execute(
            select(Meeting).where(and_(Meeting.id == uuid.UUID(meeting_id), Meeting.user_id == user.id))
        )
    ).scalar_one_or_none()
    if meeting is None:
        raise HTTPException(status_code=404, detail="Meeting not found")

    now = datetime.now(timezone.utc)
    start = meeting.start_time
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    mins_until = max(0, int((start - now).total_seconds() / 60))

    # Gather context: notes mentioning the meeting title, open tasks
    notes_q = (
        await db.execute(
            select(Note.title, Note.content).where(
                and_(Note.user_id == user.id)
            ).order_by(Note.updated_at.desc()).limit(10)
        )
    ).all()
    note_snippets = "\n".join(
        f"- {n[0]}: {(n[1] or '')[:200]}" for n in notes_q
        if meeting.title.lower().split()[0] in (n[0] or "").lower()
    )

    tasks_q = (
        await db.execute(
            select(Task.title, Task.deadline).where(
                and_(Task.user_id == user.id, Task.status != "done")
            ).order_by(Task.deadline.asc().nulls_last()).limit(10)
        )
    ).all()
    task_lines = "\n".join(
        f"- {t[0]} (due {t[1].isoformat() if t[1] else 'no deadline'})"
        for t in tasks_q
    )

    prompt = (
        f"Meeting: {meeting.title}\n"
        f"Description: {meeting.description or 'none'}\n"
        f"Starts in: {mins_until} minutes\n"
        f"Category: {meeting.category}\n\n"
        f"Related notes:\n{note_snippets or '(none found)'}\n\n"
        f"Open tasks:\n{task_lines or '(none)'}"
    )

    try:
        import json
        raw = await genai_generate(_PREP_SYSTEM, prompt, temperature=0.4, json_mode=True)
        data = json.loads(raw)
    except Exception:
        data = {
            "brief": f"Review your notes on \"{meeting.title}\" before joining.",
            "unresolved_actions": [],
            "discussion_questions": [],
            "relevant_deadlines": [],
        }

    return PrepBrief(
        meeting_id=meeting_id,
        meeting_title=meeting.title,
        starts_in_minutes=mins_until,
        brief=str(data.get("brief", "")),
        unresolved_actions=[str(a) for a in data.get("unresolved_actions", [])],
        discussion_questions=[str(q) for q in data.get("discussion_questions", [])],
        relevant_deadlines=[str(d) for d in data.get("relevant_deadlines", [])],
    )


# ---------------------------------------------------------------------------
# Feature 6: Context-Aware Notification Suppression
# ---------------------------------------------------------------------------

class ReminderCheck(BaseModel):
    should_fire: bool
    reason: str
    suggested_time: str | None = None
    suppression_count: int = 0


@router.get("/reminder-check/{task_id}", response_model=ReminderCheck)
async def reminder_check(
    task_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ReminderCheck:
    """Check if a reminder should fire now or be suppressed due to active focus/class blocks."""
    now = datetime.now(timezone.utc)

    # Check for active meeting/class/focus block
    active_block = (
        await db.execute(
            select(Meeting).where(
                and_(
                    Meeting.user_id == user.id,
                    Meeting.start_time <= now,
                    Meeting.end_time >= now,
                )
            )
        )
    ).scalar_one_or_none()

    if active_block:
        # Find the next free slot after this block
        next_free = active_block.end_time
        if next_free.tzinfo is None:
            next_free = next_free.replace(tzinfo=timezone.utc)

        # Check if there's another meeting right after
        next_meeting = (
            await db.execute(
                select(Meeting).where(
                    and_(
                        Meeting.user_id == user.id,
                        Meeting.start_time >= next_free,
                        Meeting.start_time <= next_free + timedelta(minutes=15),
                    )
                ).order_by(Meeting.start_time.asc()).limit(1)
            )
        ).scalar_one_or_none()

        if next_meeting:
            suggested = next_meeting.end_time.isoformat() if next_meeting.end_time else None
        else:
            suggested = next_free.isoformat()

        return ReminderCheck(
            should_fire=False,
            reason=f"Suppressed — you're in \"{active_block.title}\" until {next_free.strftime('%H:%M')}.",
            suggested_time=suggested,
        )

    return ReminderCheck(
        should_fire=True,
        reason="No active blocks — reminder is clear to fire.",
    )
