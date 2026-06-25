from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.llm import genai_generate
from app.models import Flashcard, User
from app.security import get_current_user

router = APIRouter()

# Leitner spacing: how long until a card in each box is due again.
_INTERVALS = {
    1: timedelta(minutes=10),
    2: timedelta(days=1),
    3: timedelta(days=3),
    4: timedelta(days=7),
    5: timedelta(days=16),
}


def _interval(box: int) -> timedelta:
    return _INTERVALS.get(max(1, min(5, box)), timedelta(days=1))


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class CardCreate(BaseModel):
    deck: str = Field("General", max_length=255)
    front: str
    back: str


class CardOut(BaseModel):
    id: uuid.UUID
    deck: str
    front: str
    back: str
    box: int
    due_at: datetime
    times_reviewed: int


class ReviewBody(BaseModel):
    grade: str  # "again" | "good" | "easy"


class GenerateBody(BaseModel):
    topic: str
    deck: str = Field("General", max_length=255)
    count: int = Field(8, ge=1, le=20)


class DeckOut(BaseModel):
    deck: str
    total: int
    due: int


def _out(c: Flashcard) -> CardOut:
    return CardOut(
        id=c.id, deck=c.deck, front=c.front, back=c.back,
        box=c.box, due_at=c.due_at, times_reviewed=c.times_reviewed,
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("", response_model=list[CardOut])
async def list_cards(
    deck: str | None = None,
    due: bool = False,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[CardOut]:
    conditions = [Flashcard.user_id == user.id]
    if deck:
        conditions.append(Flashcard.deck == deck)
    if due:
        conditions.append(Flashcard.due_at <= datetime.now(timezone.utc))
    rows = (
        await db.execute(
            select(Flashcard).where(and_(*conditions)).order_by(Flashcard.due_at.asc())
        )
    ).scalars().all()
    return [_out(c) for c in rows]


@router.get("/decks", response_model=list[DeckOut])
async def list_decks(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[DeckOut]:
    now = datetime.now(timezone.utc)
    rows = (
        await db.execute(
            select(
                Flashcard.deck,
                func.count(Flashcard.id),
                func.count(Flashcard.id).filter(Flashcard.due_at <= now),
            )
            .where(Flashcard.user_id == user.id)
            .group_by(Flashcard.deck)
            .order_by(Flashcard.deck.asc())
        )
    ).all()
    return [DeckOut(deck=r[0], total=r[1], due=r[2]) for r in rows]


@router.post("", response_model=CardOut)
async def create_card(
    body: CardCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CardOut:
    if not body.front.strip() or not body.back.strip():
        raise HTTPException(status_code=400, detail="Front and back are required")
    card = Flashcard(
        user_id=user.id,
        deck=(body.deck.strip() or "General"),
        front=body.front.strip(),
        back=body.back.strip(),
    )
    db.add(card)
    await db.flush()
    await db.refresh(card)
    return _out(card)


@router.post("/review/{card_id}", response_model=CardOut)
async def review_card(
    card_id: uuid.UUID,
    body: ReviewBody,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CardOut:
    card = (
        await db.execute(
            select(Flashcard).where(
                and_(Flashcard.id == card_id, Flashcard.user_id == user.id)
            )
        )
    ).scalar_one_or_none()
    if card is None:
        raise HTTPException(status_code=404, detail="Card not found")

    if body.grade == "again":
        card.box = 1
    elif body.grade == "easy":
        card.box = min(5, card.box + 2)
    else:  # "good" (default)
        card.box = min(5, card.box + 1)

    card.due_at = datetime.now(timezone.utc) + _interval(card.box)
    card.times_reviewed += 1
    await db.flush()
    await db.refresh(card)
    return _out(card)


@router.delete("/{card_id}")
async def delete_card(
    card_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    card = (
        await db.execute(
            select(Flashcard).where(
                and_(Flashcard.id == card_id, Flashcard.user_id == user.id)
            )
        )
    ).scalar_one_or_none()
    if card is None:
        raise HTTPException(status_code=404, detail="Card not found")
    await db.delete(card)
    await db.flush()
    return {"detail": "Card deleted"}


_GENERATE_SYSTEM = (
    "You create study flashcards. Given a topic, produce concise question/answer "
    "pairs that test understanding (not just recall of trivia). Return strict JSON: "
    '{"cards": [{"front": "question", "back": "answer"}]}. '
    "Keep each side under 240 characters. No markdown."
)


@router.post("/generate", response_model=list[CardOut])
async def generate_cards(
    body: GenerateBody,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[CardOut]:
    prompt = (
        f"Topic: {body.topic.strip()}\n"
        f"Generate {body.count} flashcards covering the most important points."
    )
    try:
        raw = await genai_generate(_GENERATE_SYSTEM, prompt, temperature=0.4)
        data = json.loads(raw)
    except Exception as exc:  # noqa: BLE001 — AI/key/parse failure
        raise HTTPException(
            status_code=503,
            detail="Couldn't generate cards right now. Check your Gemini API key.",
        ) from exc

    items = data.get("cards", data if isinstance(data, list) else [])
    deck = body.deck.strip() or "General"
    created: list[Flashcard] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        front = str(it.get("front", "")).strip()
        back = str(it.get("back", "")).strip()
        if not front or not back:
            continue
        card = Flashcard(user_id=user.id, deck=deck, front=front, back=back)
        db.add(card)
        created.append(card)

    if not created:
        raise HTTPException(status_code=422, detail="No usable cards were generated")

    await db.flush()
    for c in created:
        await db.refresh(c)
    return [_out(c) for c in created]
