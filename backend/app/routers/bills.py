from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from dateutil.relativedelta import relativedelta
from fastapi import APIRouter, Depends, HTTPException, Query, status
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from pydantic import BaseModel, Field
from sqlalchemy import and_, extract, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import Bill, User
from app.openai_client import openai_client as _oai, LLM_MODEL
from app.security import get_current_user

router = APIRouter()

# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

_RECURRENCE_PATTERN = r"^(monthly|weekly|yearly|one-time)$"
_CATEGORY_PATTERN = r"^(subscription|utility|insurance|rent|other)$"
_PLATFORM_PATTERN = r"^(google_pay|app_store|manual|bank)$"
_STATUS_PATTERN = r"^(pending|paid|overdue|autopay)$"
_CURRENCY_PATTERN = r"^(INR|USD)$"


class BillCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=1024)
    amount: Decimal = Field(..., gt=0, max_digits=12, decimal_places=2)
    currency: str = Field(default="INR", pattern=_CURRENCY_PATTERN)
    due_date: datetime
    recurrence: str = Field(default="one-time", pattern=_RECURRENCE_PATTERN)
    category: str = Field(default="other", pattern=_CATEGORY_PATTERN)
    platform: str = Field(default="manual", pattern=_PLATFORM_PATTERN)
    autopay_enabled: bool = False
    payment_url: str | None = None
    notes: str | None = None


class BillUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=1024)
    amount: Decimal | None = Field(default=None, gt=0, max_digits=12, decimal_places=2)
    currency: str | None = Field(default=None, pattern=_CURRENCY_PATTERN)
    due_date: datetime | None = None
    recurrence: str | None = Field(default=None, pattern=_RECURRENCE_PATTERN)
    category: str | None = Field(default=None, pattern=_CATEGORY_PATTERN)
    platform: str | None = Field(default=None, pattern=_PLATFORM_PATTERN)
    autopay_enabled: bool | None = None
    payment_url: str | None = None
    notes: str | None = None


class BillResponse(BaseModel):
    id: uuid.UUID
    name: str
    amount: float
    currency: str
    due_date: datetime
    recurrence: str
    category: str
    platform: str
    status: str
    autopay_enabled: bool
    payment_url: str | None
    notes: str | None
    paid_at: datetime | None
    days_until_due: int | None
    created_at: datetime
    updated_at: datetime


class BillSummary(BaseModel):
    total_pending_amount: float
    total_paid_this_month: float
    overdue_count: int
    autopay_count: int


class DetectedBill(BaseModel):
    name: str
    amount: float | None
    currency: str
    due_date: str | None
    category: str
    source_email_subject: str
    source_email_id: str
    confidence: float


class DetectedBillsResponse(BaseModel):
    detected: list[DetectedBill]
    emails_scanned: int


class DeleteResponse(BaseModel):
    detail: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ensure_tz(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _days_until_due(due_date: datetime) -> int | None:
    now = datetime.now(timezone.utc)
    dl = _ensure_tz(due_date)
    return (dl - now).days


def _bill_to_response(bill: Bill) -> BillResponse:
    return BillResponse(
        id=bill.id,
        name=bill.name,
        amount=float(bill.amount),
        currency=bill.currency,
        due_date=bill.due_date,
        recurrence=bill.recurrence,
        category=bill.category,
        platform=bill.platform,
        status=bill.status,
        autopay_enabled=bill.autopay_enabled,
        payment_url=bill.payment_url,
        notes=bill.notes,
        paid_at=bill.paid_at,
        days_until_due=_days_until_due(bill.due_date),
        created_at=bill.created_at,
        updated_at=bill.updated_at,
    )


async def _get_user_bill(
    bill_id: uuid.UUID, user: User, db: AsyncSession
) -> Bill:
    result = await db.execute(
        select(Bill).where(and_(Bill.id == bill_id, Bill.user_id == user.id))
    )
    bill = result.scalar_one_or_none()
    if bill is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Bill not found",
        )
    return bill


def _next_due_date(current: datetime, recurrence: str) -> datetime:
    dt = _ensure_tz(current)
    if recurrence == "weekly":
        return dt + timedelta(weeks=1)
    if recurrence == "monthly":
        return dt + relativedelta(months=1)
    if recurrence == "yearly":
        return dt + relativedelta(years=1)
    return dt


# ---------------------------------------------------------------------------
# Gmail helpers
# ---------------------------------------------------------------------------

BILL_KEYWORDS: list[str] = [
    "invoice",
    "payment due",
    "subscription renewal",
    "amount due",
    "billing statement",
    "auto-debit",
    "autopay",
]

GOOGLE_SCOPES: list[str] = [
    "https://www.googleapis.com/auth/gmail.readonly",
]


def _build_gmail_credentials(user: User) -> Credentials:
    if not user.google_access_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Google account not connected",
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


def _gmail_search_bills(creds: Credentials, max_results: int = 15) -> list[dict[str, Any]]:
    service = build("gmail", "v1", credentials=creds, cache_discovery=False)
    query = " OR ".join(f'"{kw}"' for kw in BILL_KEYWORDS)
    listed = (
        service.users()
        .messages()
        .list(userId="me", q=query, maxResults=max_results)
        .execute()
    )
    message_refs: list[dict[str, str]] = listed.get("messages", [])
    messages: list[dict[str, Any]] = []
    for ref in message_refs:
        msg = (
            service.users()
            .messages()
            .get(
                userId="me",
                id=ref["id"],
                format="metadata",
                metadataHeaders=["Subject", "From", "Date"],
            )
            .execute()
        )
        messages.append(msg)
    return messages


def _header(msg: dict[str, Any], name: str) -> str:
    headers = msg.get("payload", {}).get("headers", [])
    for h in headers:
        if h.get("name", "").lower() == name.lower():
            return h.get("value", "")
    return ""


_BILL_EXTRACTION_PROMPT = (
    "You extract bill/payment details from an email. "
    "Return strict JSON with keys: "
    "name (string — the vendor/service name), "
    "amount (number or null), "
    "currency ('INR' or 'USD', infer from context, default 'INR'), "
    "due_date (ISO 8601 date string or null), "
    "category (one of 'subscription','utility','insurance','rent','other'), "
    "is_bill (boolean — true only if this is genuinely a bill/invoice/payment notice), "
    "confidence (float 0-1 — how confident you are this is a real bill)."
)


async def _extract_bill_with_openai(
    client: Any,
    subject: str,
    sender: str,
    snippet: str,
) -> dict[str, Any] | None:
    user_content = (
        f"Subject: {subject}\n"
        f"From: {sender}\n"
        f"Snippet: {snippet}\n\n"
        "Extract bill details as JSON."
    )
    completion = await client.chat.completions.create(
        model=LLM_MODEL,
        response_format={"type": "json_object"},
        temperature=0,
        messages=[
            {"role": "system", "content": _BILL_EXTRACTION_PROMPT},
            {"role": "user", "content": user_content},
        ],
    )
    raw = completion.choices[0].message.content
    if not raw:
        return None
    try:
        data: dict[str, Any] = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not data.get("is_bill"):
        return None
    return data


# ---------------------------------------------------------------------------
# 1. GET /bills
# ---------------------------------------------------------------------------

@router.get("", response_model=list[BillResponse])
async def list_bills(
    status_filter: str | None = Query(default=None, alias="status"),
    category: str | None = Query(default=None),
    due_before: datetime | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[BillResponse]:
    stmt = select(Bill).where(Bill.user_id == user.id)

    if status_filter:
        if status_filter not in ("pending", "paid", "overdue", "autopay"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="status must be 'pending', 'paid', 'overdue', or 'autopay'",
            )
        stmt = stmt.where(Bill.status == status_filter)

    if category:
        if category not in ("subscription", "utility", "insurance", "rent", "other"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="category must be 'subscription', 'utility', 'insurance', 'rent', or 'other'",
            )
        stmt = stmt.where(Bill.category == category)

    if due_before:
        stmt = stmt.where(Bill.due_date <= due_before)

    stmt = stmt.order_by(Bill.due_date.asc())
    result = await db.execute(stmt)
    bills = result.scalars().all()
    return [_bill_to_response(b) for b in bills]


# ---------------------------------------------------------------------------
# 2. POST /bills
# ---------------------------------------------------------------------------

@router.post("", response_model=BillResponse, status_code=status.HTTP_201_CREATED)
async def create_bill(
    body: BillCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BillResponse:
    bill = Bill(
        user_id=user.id,
        name=body.name,
        amount=body.amount,
        currency=body.currency,
        due_date=body.due_date,
        recurrence=body.recurrence,
        category=body.category,
        platform=body.platform,
        status="autopay" if body.autopay_enabled else "pending",
        autopay_enabled=body.autopay_enabled,
        payment_url=body.payment_url,
        notes=body.notes,
    )
    db.add(bill)
    await db.flush()
    await db.refresh(bill)
    return _bill_to_response(bill)


# ---------------------------------------------------------------------------
# 3. PATCH /bills/{bill_id}/mark-paid
# ---------------------------------------------------------------------------

@router.patch("/{bill_id}/mark-paid", response_model=BillResponse)
async def mark_bill_paid(
    bill_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BillResponse:
    bill = await _get_user_bill(bill_id, user, db)

    if bill.status == "paid":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Bill is already marked as paid",
        )

    now = datetime.now(timezone.utc)
    bill.status = "paid"
    bill.paid_at = now

    # If recurring, create the next bill instance.
    if bill.recurrence != "one-time":
        next_due = _next_due_date(bill.due_date, bill.recurrence)
        next_bill = Bill(
            user_id=user.id,
            name=bill.name,
            amount=bill.amount,
            currency=bill.currency,
            due_date=next_due,
            recurrence=bill.recurrence,
            category=bill.category,
            platform=bill.platform,
            status="autopay" if bill.autopay_enabled else "pending",
            autopay_enabled=bill.autopay_enabled,
            payment_url=bill.payment_url,
            notes=bill.notes,
        )
        db.add(next_bill)

    await db.flush()
    await db.refresh(bill)
    return _bill_to_response(bill)


# ---------------------------------------------------------------------------
# 4. GET /bills/upcoming
# ---------------------------------------------------------------------------

@router.get("/upcoming", response_model=list[BillResponse])
async def upcoming_bills(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[BillResponse]:
    now = datetime.now(timezone.utc)
    week_out = now + timedelta(days=7)

    result = await db.execute(
        select(Bill).where(
            and_(
                Bill.user_id == user.id,
                Bill.status != "paid",
                Bill.due_date >= now,
                Bill.due_date <= week_out,
            )
        ).order_by(Bill.due_date.asc())
    )
    bills = result.scalars().all()
    return [_bill_to_response(b) for b in bills]


# ---------------------------------------------------------------------------
# 5. GET /bills/summary
# ---------------------------------------------------------------------------

@router.get("/summary", response_model=BillSummary)
async def bills_summary(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BillSummary:
    now = datetime.now(timezone.utc)

    # All user bills.
    result = await db.execute(
        select(Bill).where(Bill.user_id == user.id)
    )
    all_bills = result.scalars().all()

    total_pending = 0.0
    total_paid_this_month = 0.0
    overdue_count = 0
    autopay_count = 0

    for b in all_bills:
        if b.status in ("pending", "autopay"):
            total_pending += float(b.amount)
        if b.autopay_enabled:
            autopay_count += 1
        if b.status == "overdue" or (
            b.status in ("pending",) and _ensure_tz(b.due_date) < now
        ):
            overdue_count += 1
        if (
            b.status == "paid"
            and b.paid_at is not None
            and _ensure_tz(b.paid_at).year == now.year
            and _ensure_tz(b.paid_at).month == now.month
        ):
            total_paid_this_month += float(b.amount)

    return BillSummary(
        total_pending_amount=round(total_pending, 2),
        total_paid_this_month=round(total_paid_this_month, 2),
        overdue_count=overdue_count,
        autopay_count=autopay_count,
    )


# ---------------------------------------------------------------------------
# 6. POST /bills/detect-from-email
# ---------------------------------------------------------------------------

@router.post("/detect-from-email", response_model=DetectedBillsResponse)
async def detect_bills_from_email(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DetectedBillsResponse:
    creds = _build_gmail_credentials(user)

    messages = await asyncio.to_thread(_gmail_search_bills, creds, 15)

    # Persist refreshed token if changed.
    if creds.token != user.google_access_token:
        user.google_access_token = creds.token
        expiry = creds.expiry
        if expiry is not None and expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=timezone.utc)
        user.google_token_expiry = expiry
        await db.flush()

    # Run all AI extractions concurrently instead of sequentially.
    async def _process_msg(msg: dict[str, Any]) -> DetectedBill | None:
        subject = _header(msg, "Subject")
        sender = _header(msg, "From")
        snippet = msg.get("snippet", "")
        message_id: str = msg["id"]

        data = await _extract_bill_with_openai(_oai, subject, sender, snippet)
        if data is None:
            return None

        valid_categories = {"subscription", "utility", "insurance", "rent", "other"}
        cat = str(data.get("category", "other")).lower()
        if cat not in valid_categories:
            cat = "other"

        currency = str(data.get("currency", "INR")).upper()
        if currency not in ("INR", "USD"):
            currency = "INR"

        return DetectedBill(
            name=str(data.get("name", subject)),
            amount=data.get("amount"),
            currency=currency,
            due_date=data.get("due_date"),
            category=cat,
            source_email_subject=subject,
            source_email_id=message_id,
            confidence=float(data.get("confidence", 0.5)),
        )

    results = await asyncio.gather(*[_process_msg(m) for m in messages])
    detected = [r for r in results if r is not None]

    return DetectedBillsResponse(
        detected=detected,
        emails_scanned=len(messages),
    )
