import os
import secrets
import time
import uuid
from datetime import datetime, timezone

from app.config import settings

os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")
# Only relax HTTPS enforcement in local DEBUG. In production, OAuth MUST run
# over HTTPS — otherwise tokens transit in cleartext.
if settings.DEBUG:
    os.environ.setdefault("OAUTHLIB_INSECURE_TRANSPORT", "1")

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import RedirectResponse
from google.auth.exceptions import RefreshError
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import User
from app.security import create_access_token, decode_access_token

import logging

logger = logging.getLogger("producty.auth")

router = APIRouter()

GOOGLE_SCOPES: list[str] = [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/gmail.readonly",
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
]

GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"

# In-memory stores. Production would use Redis; fine for single-process dev.
# Entries carry a timestamp so we can expire them and avoid unbounded growth /
# stale one-time codes lingering forever.
_FLOW_TTL = 600     # 10 min to complete the Google consent screen
_CODE_TTL = 120     # 2 min to exchange the one-time code for a JWT
_pending_flows: dict[str, tuple[float, Flow]] = {}
_auth_codes: dict[str, tuple[float, str]] = {}


def _sweep_expired() -> None:
    now = time.monotonic()
    for k in [k for k, (ts, _) in _pending_flows.items() if now - ts > _FLOW_TTL]:
        _pending_flows.pop(k, None)
    for k in [k for k, (ts, _) in _auth_codes.items() if now - ts > _CODE_TTL]:
        _auth_codes.pop(k, None)


def _build_flow(state: str | None = None) -> Flow:
    client_config: dict[str, dict[str, object]] = {
        "web": {
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [settings.GOOGLE_REDIRECT_URI],
        }
    }
    flow = Flow.from_client_config(
        client_config,
        scopes=GOOGLE_SCOPES,
        state=state,
    )
    flow.redirect_uri = settings.GOOGLE_REDIRECT_URI
    return flow


class LoginResponse(BaseModel):
    authorization_url: str
    state: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    token: str


class CodeExchangeRequest(BaseModel):
    code: str


# ---------------------------------------------------------------------------
# 1. GET /google/login — generate auth URL with CSRF state
# ---------------------------------------------------------------------------

@router.get("/google/login", response_model=LoginResponse)
async def google_login() -> LoginResponse:
    flow = _build_flow()
    authorization_url, state = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
    )
    # Store the entire flow object so the callback can reuse its code_verifier (PKCE).
    _sweep_expired()
    _pending_flows[state] = (time.monotonic(), flow)
    return LoginResponse(authorization_url=authorization_url, state=state)


# ---------------------------------------------------------------------------
# 2. GET /google/callback — exchange code, issue one-time auth code (not JWT)
# ---------------------------------------------------------------------------

@router.get("/google/callback")
async def google_callback(
    code: str = Query(...),
    state: str = Query(...),
    db: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    # Retrieve the original Flow (with its PKCE code_verifier) and validate state.
    entry = _pending_flows.pop(state, None)
    if entry is None or (time.monotonic() - entry[0]) > _FLOW_TTL:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or expired OAuth state — possible CSRF attack",
        )
    flow = entry[1]

    try:
        flow.fetch_token(code=code)
    except Exception as exc:
        # Log the detail server-side; return a generic message to the client.
        logger.warning("OAuth token exchange failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to exchange authorization code",
        ) from exc

    credentials = flow.credentials

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {credentials.token}"},
        )
    if resp.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to fetch user profile from Google",
        )
    profile: dict[str, object] = resp.json()

    email = profile.get("email")
    if not isinstance(email, str):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google profile did not include an email",
        )
    name = profile.get("name")
    picture = profile.get("picture")

    token_expiry: datetime | None = credentials.expiry
    if token_expiry is not None and token_expiry.tzinfo is None:
        token_expiry = token_expiry.replace(tzinfo=timezone.utc)

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    if user is None:
        user = User(
            email=email,
            name=name if isinstance(name, str) else None,
            picture_url=picture if isinstance(picture, str) else None,
            google_access_token=credentials.token,
            google_refresh_token=credentials.refresh_token,
            google_token_expiry=token_expiry,
        )
        db.add(user)
    else:
        user.name = name if isinstance(name, str) else user.name
        user.picture_url = picture if isinstance(picture, str) else user.picture_url
        user.google_access_token = credentials.token
        if credentials.refresh_token:
            user.google_refresh_token = credentials.refresh_token
        user.google_token_expiry = token_expiry

    await db.flush()
    await db.refresh(user)

    # Issue a short-lived one-time code instead of putting the JWT in the URL.
    auth_code = secrets.token_urlsafe(32)
    _auth_codes[auth_code] = (time.monotonic(), str(user.id))

    redirect_url = f"{settings.FRONTEND_URL}/auth/callback?code={auth_code}"
    return RedirectResponse(url=redirect_url)


# ---------------------------------------------------------------------------
# 3. POST /google/exchange — frontend exchanges one-time code for JWT
# ---------------------------------------------------------------------------

@router.post("/google/exchange", response_model=TokenResponse)
async def exchange_code(body: CodeExchangeRequest) -> TokenResponse:
    entry = _auth_codes.pop(body.code, None)
    if entry is None or (time.monotonic() - entry[0]) > _CODE_TTL:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired auth code",
        )
    jwt_token = create_access_token(subject=entry[1])
    return TokenResponse(access_token=jwt_token)


# ---------------------------------------------------------------------------
# 4. POST /refresh
# ---------------------------------------------------------------------------

@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(
    body: RefreshRequest,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    payload = decode_access_token(body.token)
    subject = payload.get("sub")
    if not isinstance(subject, str):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        )

    try:
        user_id = uuid.UUID(subject)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        ) from exc

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )

    now = datetime.now(timezone.utc)
    expiry = user.google_token_expiry
    if expiry is not None and expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)

    if user.google_refresh_token and (expiry is None or expiry <= now):
        credentials = Credentials(
            token=user.google_access_token,
            refresh_token=user.google_refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=settings.GOOGLE_CLIENT_ID,
            client_secret=settings.GOOGLE_CLIENT_SECRET,
            scopes=GOOGLE_SCOPES,
        )
        try:
            credentials.refresh(GoogleRequest())
        except RefreshError as exc:
            logger.warning("Google token refresh failed: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to refresh Google token — please sign in again",
            ) from exc

        new_expiry: datetime | None = credentials.expiry
        if new_expiry is not None and new_expiry.tzinfo is None:
            new_expiry = new_expiry.replace(tzinfo=timezone.utc)

        user.google_access_token = credentials.token
        user.google_token_expiry = new_expiry
        await db.flush()

    new_jwt = create_access_token(subject=str(user.id))
    return TokenResponse(access_token=new_jwt)
