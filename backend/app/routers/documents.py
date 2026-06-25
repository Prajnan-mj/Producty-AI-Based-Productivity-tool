from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import and_, desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.llm import genai_generate
from app.models import Document, User
from app.security import get_current_user
from app.security_utils import validate_upload
from app.services import ai_service
from app.services.ai_service import DocumentAnalysis

router = APIRouter()

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
ALLOWED_EXTENSIONS = {".pdf", ".docx", ".doc", ".png", ".jpg", ".jpeg"}


class DocumentAnalysisResponse(BaseModel):
    document_id: uuid.UUID
    filename: str
    analysis: DocumentAnalysis
    created_at: datetime


class DocumentListItem(BaseModel):
    id: uuid.UUID
    filename: str
    file_type: str
    summary: str | None
    created_at: datetime


def _ext(filename: str) -> str:
    idx = filename.rfind(".")
    return filename[idx:].lower() if idx != -1 else ""


async def _read_capped(file, limit: int) -> bytes:
    """Read an UploadFile in chunks, aborting if it exceeds `limit` bytes."""
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(64 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="File exceeds the 10MB limit",
            )
        chunks.append(chunk)
    return b"".join(chunks)


@router.post("/analyze", response_model=DocumentAnalysisResponse)
async def analyze(
    file: UploadFile = File(...),
    user_context: str = Form(default=""),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DocumentAnalysisResponse:
    filename = file.filename or "upload"
    ext = _ext(filename)

    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported file type '{ext}'. Allowed: {sorted(ALLOWED_EXTENSIONS)}",
        )

    # Reject oversized uploads BEFORE reading the whole body into memory (DoS).
    declared = file.size
    if declared is not None and declared > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File exceeds the 10MB limit",
        )

    # Stream-read with a hard cap so a missing/lying Content-Length can't OOM us.
    content = await _read_capped(file, MAX_FILE_SIZE)
    if len(content) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty",
        )

    # Verify the bytes actually match the claimed extension (anti-spoofing).
    validate_upload(content, ext)

    analysis = await ai_service.analyze_document(content, filename, user_context)

    document = Document(
        user_id=user.id,
        filename=filename,
        file_type=ext.lstrip("."),
        summary=analysis.summary,
        analysis=analysis.model_dump(),
    )
    db.add(document)
    await db.flush()
    await db.refresh(document)

    return DocumentAnalysisResponse(
        document_id=document.id,
        filename=document.filename,
        analysis=analysis,
        created_at=document.created_at,
    )


@router.get("", response_model=list[DocumentListItem])
async def list_documents(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[DocumentListItem]:
    result = await db.execute(
        select(Document)
        .where(Document.user_id == user.id)
        .order_by(desc(Document.created_at))
    )
    docs = result.scalars().all()
    return [
        DocumentListItem(
            id=d.id,
            filename=d.filename,
            file_type=d.file_type,
            summary=d.summary,
            created_at=d.created_at,
        )
        for d in docs
    ]


@router.get("/{document_id}", response_model=DocumentAnalysisResponse)
async def get_document(
    document_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DocumentAnalysisResponse:
    result = await db.execute(
        select(Document).where(
            and_(Document.id == document_id, Document.user_id == user.id)
        )
    )
    document = result.scalar_one_or_none()
    if document is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found",
        )

    return DocumentAnalysisResponse(
        document_id=document.id,
        filename=document.filename,
        analysis=DocumentAnalysis.model_validate(document.analysis or {}),
        created_at=document.created_at,
    )


# ---------------------------------------------------------------------------
# Feature 2: Syllabus / Meeting-Doc Ingestion
# ---------------------------------------------------------------------------

_SYLLABUS_SYSTEM = (
    "Extract every gradeable/deliverable deadline from this syllabus: "
    "assignments, exams, project milestones, attendance-critical sessions. "
    'Return JSON: {"deadlines": [{"title": "...", "due_date": "ISO 8601", '
    '"weight_pct": <number or null>, "course_name": "..."}]}. '
    "Infer the academic year from context if not explicit."
)

_MEETING_NOTES_SYSTEM = (
    "Extract every action item, owner, and deadline mentioned in these "
    'meeting notes. Return JSON: {"actions": [{"action": "...", "owner": "...", '
    '"due_date": "ISO 8601 or null", "priority": "high|medium|low"}]}.'
)


class ExtractedDeadline(BaseModel):
    title: str
    due_date: str | None = None
    weight_pct: float | None = None
    course_name: str | None = None


class ExtractedAction(BaseModel):
    action: str
    owner: str | None = None
    due_date: str | None = None
    priority: str = "medium"


class ExtractionResponse(BaseModel):
    mode: str  # "syllabus" | "meeting"
    deadlines: list[ExtractedDeadline] = []
    actions: list[ExtractedAction] = []


@router.post("/{document_id}/extract-deadlines", response_model=ExtractionResponse)
async def extract_deadlines(
    document_id: uuid.UUID,
    mode: str = "syllabus",
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ExtractionResponse:
    doc = (
        await db.execute(
            select(Document).where(and_(Document.id == document_id, Document.user_id == user.id))
        )
    ).scalar_one_or_none()
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")

    analysis = doc.analysis or {}
    doc_text = analysis.get("summary", "") + "\n"
    for dl in analysis.get("deadlines", []):
        doc_text += f"- {dl.get('item', '')}: {dl.get('date', '')}\n"
    for step in analysis.get("action_plan", []):
        doc_text += f"- {step.get('step', '')} (priority: {step.get('priority', '')}, deadline: {step.get('deadline', '')})\n"

    if not doc_text.strip():
        raise HTTPException(status_code=422, detail="No content to extract from")

    system = _SYLLABUS_SYSTEM if mode == "syllabus" else _MEETING_NOTES_SYSTEM

    try:
        import json
        raw = await genai_generate(system, f"Document: {doc.filename}\n\n{doc_text[:20000]}", temperature=0.2)
        data = json.loads(raw)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="AI extraction failed") from exc

    if mode == "syllabus":
        deadlines = [
            ExtractedDeadline(
                title=str(d.get("title", "")),
                due_date=d.get("due_date"),
                weight_pct=d.get("weight_pct"),
                course_name=d.get("course_name"),
            )
            for d in data.get("deadlines", []) if isinstance(d, dict)
        ]
        return ExtractionResponse(mode="syllabus", deadlines=deadlines)
    else:
        actions = [
            ExtractedAction(
                action=str(a.get("action", "")),
                owner=a.get("owner"),
                due_date=a.get("due_date"),
                priority=str(a.get("priority", "medium")),
            )
            for a in data.get("actions", []) if isinstance(a, dict)
        ]
        return ExtractionResponse(mode="meeting", actions=actions)
