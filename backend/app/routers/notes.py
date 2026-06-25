from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from openai import APIError, RateLimitError
from pydantic import BaseModel, Field
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Folder, Note, Task, User
from app.openai_client import openai_client, LLM_MODEL
from app.security import get_current_user

router = APIRouter()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class FolderCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    parent_id: uuid.UUID | None = None


class FolderResponse(BaseModel):
    id: uuid.UUID
    name: str
    parent_id: uuid.UUID | None
    created_at: datetime


class NoteCreate(BaseModel):
    title: str = Field(default="Untitled", max_length=512)
    content: str = Field(default="", max_length=2_000_000)
    folder_id: uuid.UUID | None = None
    emoji: str = Field(default="📄", max_length=16)


class NoteUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=512)
    content: str | None = Field(default=None, max_length=2_000_000)
    folder_id: uuid.UUID | None = None
    emoji: str | None = Field(default=None, max_length=16)
    cover_gradient: str | None = None
    word_count: int | None = None


class MoveRequest(BaseModel):
    folder_id: uuid.UUID | None = None


class NoteResponse(BaseModel):
    id: uuid.UUID
    folder_id: uuid.UUID | None
    title: str
    content: str
    ai_summary: str | None
    emoji: str
    cover_gradient: str | None
    is_favorite: bool
    word_count: int
    created_at: datetime
    updated_at: datetime


def _note_resp(n: Note) -> NoteResponse:
    return NoteResponse(
        id=n.id, folder_id=n.folder_id, title=n.title, content=n.content,
        ai_summary=n.ai_summary, emoji=n.emoji, cover_gradient=n.cover_gradient,
        is_favorite=n.is_favorite, word_count=n.word_count,
        created_at=n.created_at, updated_at=n.updated_at,
    )


# ---------------------------------------------------------------------------
# Folders
# ---------------------------------------------------------------------------

@router.get("/folders", response_model=list[FolderResponse])
async def list_folders(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[FolderResponse]:
    result = await db.execute(
        select(Folder).where(Folder.user_id == user.id).order_by(Folder.created_at.asc())
    )
    return [
        FolderResponse(id=f.id, name=f.name, parent_id=f.parent_id, created_at=f.created_at)
        for f in result.scalars().all()
    ]


@router.post("/folders", response_model=FolderResponse, status_code=status.HTTP_201_CREATED)
async def create_folder(
    body: FolderCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> FolderResponse:
    if body.parent_id is not None:
        parent = (
            await db.execute(
                select(Folder).where(
                    and_(Folder.id == body.parent_id, Folder.user_id == user.id)
                )
            )
        ).scalar_one_or_none()
        if parent is None:
            raise HTTPException(status_code=404, detail="Parent folder not found")

    folder = Folder(user_id=user.id, name=body.name, parent_id=body.parent_id)
    db.add(folder)
    await db.flush()
    await db.refresh(folder)
    return FolderResponse(id=folder.id, name=folder.name, parent_id=folder.parent_id, created_at=folder.created_at)


@router.delete("/folders/{folder_id}")
async def delete_folder(
    folder_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    folder = (
        await db.execute(
            select(Folder).where(and_(Folder.id == folder_id, Folder.user_id == user.id))
        )
    ).scalar_one_or_none()
    if folder is None:
        raise HTTPException(status_code=404, detail="Folder not found")
    # DB-level ON DELETE CASCADE removes subfolders and contained notes.
    await db.delete(folder)
    await db.flush()
    return {"detail": "Folder deleted"}


# ---------------------------------------------------------------------------
# Notes
# ---------------------------------------------------------------------------

@router.get("", response_model=list[NoteResponse])
async def list_notes(
    folder_id: uuid.UUID | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[NoteResponse]:
    stmt = select(Note).where(Note.user_id == user.id)
    if folder_id is not None:
        stmt = stmt.where(Note.folder_id == folder_id)
    stmt = stmt.order_by(Note.updated_at.desc())
    result = await db.execute(stmt)
    return [_note_resp(n) for n in result.scalars().all()]


@router.post("", response_model=NoteResponse, status_code=status.HTTP_201_CREATED)
async def create_note(
    body: NoteCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> NoteResponse:
    note = Note(
        user_id=user.id,
        folder_id=body.folder_id,
        title=body.title or "Untitled",
        content=body.content or "",
        emoji=body.emoji or "📄",
    )
    db.add(note)
    await db.flush()
    await db.refresh(note)
    return _note_resp(note)


async def _get_note(note_id: uuid.UUID, user: User, db: AsyncSession) -> Note:
    note = (
        await db.execute(
            select(Note).where(and_(Note.id == note_id, Note.user_id == user.id))
        )
    ).scalar_one_or_none()
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    return note


@router.put("/{note_id}", response_model=NoteResponse)
async def update_note(
    note_id: uuid.UUID,
    body: NoteUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> NoteResponse:
    note = await _get_note(note_id, user, db)
    if body.title is not None:
        note.title = body.title
    if body.content is not None:
        note.content = body.content
    if body.emoji is not None:
        note.emoji = body.emoji
    if "cover_gradient" in body.model_fields_set:
        note.cover_gradient = body.cover_gradient
    if body.word_count is not None:
        note.word_count = body.word_count
    if "folder_id" in body.model_fields_set:
        note.folder_id = body.folder_id
    await db.flush()
    await db.refresh(note)
    return _note_resp(note)


@router.patch("/{note_id}/move", response_model=NoteResponse)
async def move_note(
    note_id: uuid.UUID,
    body: MoveRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> NoteResponse:
    note = await _get_note(note_id, user, db)
    note.folder_id = body.folder_id
    await db.flush()
    await db.refresh(note)
    return _note_resp(note)


@router.post("/{note_id}/favorite", response_model=NoteResponse)
async def toggle_favorite(
    note_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> NoteResponse:
    note = await _get_note(note_id, user, db)
    note.is_favorite = not note.is_favorite
    await db.flush()
    await db.refresh(note)
    return _note_resp(note)


@router.post("/{note_id}/duplicate", response_model=NoteResponse)
async def duplicate_note(
    note_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> NoteResponse:
    note = await _get_note(note_id, user, db)
    copy = Note(
        user_id=user.id, folder_id=note.folder_id,
        title=f"Copy of {note.title}", content=note.content,
        emoji=note.emoji, cover_gradient=note.cover_gradient, word_count=note.word_count,
    )
    db.add(copy)
    await db.flush()
    await db.refresh(copy)
    return _note_resp(copy)


@router.delete("/{note_id}")
async def delete_note(
    note_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    note = await _get_note(note_id, user, db)
    await db.delete(note)
    await db.flush()
    return {"detail": "Note deleted"}


@router.post("/{note_id}/summarize", response_model=NoteResponse)
async def summarize_note(
    note_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> NoteResponse:
    note = await _get_note(note_id, user, db)
    if not note.content.strip():
        raise HTTPException(status_code=400, detail="Note is empty")

    try:
        completion = await openai_client.chat.completions.create(
            model=LLM_MODEL,
            temperature=0.4,
            max_tokens=220,
            messages=[
                {"role": "system", "content": "You summarize notes into 2-3 crisp sentences and surface any action items."},
                {"role": "user", "content": f"Title: {note.title}\n\n{note.content[:12000]}"},
            ],
        )
        note.ai_summary = (completion.choices[0].message.content or "").strip()
    except (RateLimitError, APIError) as exc:
        raise HTTPException(
            status_code=503,
            detail=f"AI summary unavailable ({exc.__class__.__name__})",
        ) from exc

    await db.flush()
    await db.refresh(note)
    return _note_resp(note)


# ---------------------------------------------------------------------------
# AI editor actions
# ---------------------------------------------------------------------------

def _plain_text(content: str) -> str:
    """Extract readable text from a Tiptap JSON string (or return as-is)."""
    try:
        doc = json.loads(content)
    except (json.JSONDecodeError, TypeError):
        return content or ""

    parts: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            if node.get("type") == "text" and node.get("text"):
                parts.append(node["text"])
            for child in node.get("content", []) or []:
                walk(child)
            if node.get("type") in ("paragraph", "heading", "listItem"):
                parts.append("\n")
        elif isinstance(node, list):
            for n in node:
                walk(n)

    walk(doc)
    return "".join(parts).strip()


_AI_ACTIONS = {"summarize", "extract_tasks", "continue", "fix_grammar", "make_shorter", "make_longer", "generate"}

_AI_PROMPTS = {
    "summarize": "Summarize the following note in 2-4 crisp sentences.",
    "fix_grammar": "Fix all grammar and spelling in the following text. Return only the corrected text, same meaning and formatting.",
    "make_shorter": "Rewrite the following text to be significantly more concise while keeping the key points. Return only the rewritten text.",
    "make_longer": "Expand the following text with more detail and clarity. Return only the expanded text.",
    "continue": "Continue writing naturally from where this text leaves off. Return only the continuation, no preamble.",
}


class AIRequest(BaseModel):
    action: str
    selected_text: str | None = None
    prompt: str | None = None


class AITask(BaseModel):
    id: uuid.UUID
    title: str


class AIResponse(BaseModel):
    result: str
    inserted_tasks: list[AITask] = []


async def _chat(system: str, user_msg: str, json_mode: bool = False) -> str:
    kwargs: dict[str, Any] = {
        "model": LLM_MODEL,
        "temperature": 0.5,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user_msg[:14000]},
        ],
    }
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    completion = await openai_client.chat.completions.create(**kwargs)
    return (completion.choices[0].message.content or "").strip()


@router.post("/{note_id}/ai", response_model=AIResponse)
async def note_ai(
    note_id: uuid.UUID,
    body: AIRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AIResponse:
    if body.action not in _AI_ACTIONS:
        raise HTTPException(status_code=400, detail="Unknown AI action")

    note = await _get_note(note_id, user, db)
    note_text = _plain_text(note.content)
    target = (body.selected_text or note_text or "").strip()

    try:
        if body.action == "generate":
            user_msg = body.prompt or "Write a short, well-structured note."
            system = "You write clear, well-structured notes. Use short paragraphs. Plain text only."
            return AIResponse(result=await _chat(system, user_msg))

        if body.action == "extract_tasks":
            system = ("Extract every actionable task from the note. Return strict JSON: "
                      "{\"tasks\": [\"short task text\", ...]}. If none, return {\"tasks\": []}.")
            raw = await _chat(system, note_text, json_mode=True)
            try:
                tasks = json.loads(raw).get("tasks", [])
            except json.JSONDecodeError:
                tasks = []
            inserted: list[AITask] = []
            for t in tasks[:25]:
                text_t = str(t).strip()
                if not text_t:
                    continue
                task = Task(user_id=user.id, title=text_t, status="pending", source="manual",
                            description=f"From note: {note.title}")
                db.add(task)
                await db.flush()
                inserted.append(AITask(id=task.id, title=task.title))
            return AIResponse(result="\n".join(f"- {t.title}" for t in inserted), inserted_tasks=inserted)

        system = _AI_PROMPTS[body.action]
        return AIResponse(result=await _chat(system, target))

    except (RateLimitError, APIError) as exc:
        raise HTTPException(status_code=503, detail=f"AI unavailable ({exc.__class__.__name__})") from exc
