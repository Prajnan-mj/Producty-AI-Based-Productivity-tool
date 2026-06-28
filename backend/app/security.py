import logging
import uuid
from datetime import date as date_type
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import async_session_factory, get_db
from app.models import User

logger = logging.getLogger("producty.security")

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/google/login", auto_error=True)

# Per-process guard so we record each user's daily activity at most once per
# day per worker — keeps analytics writes to ~one insert/user/day.
_activity_seen: dict[uuid.UUID, date_type] = {}


async def _record_daily_activity(user_id: uuid.UUID) -> None:
    """Record that a user was active today. Fully isolated from the request's
    own DB transaction so an analytics failure can never break authentication."""
    today = datetime.now(timezone.utc).date()
    if _activity_seen.get(user_id) == today:
        return
    _activity_seen[user_id] = today
    try:
        async with async_session_factory() as s:
            await s.execute(
                text(
                    "INSERT INTO user_activity (id, user_id, day) "
                    "VALUES (:id, :uid, :day) ON CONFLICT (user_id, day) DO NOTHING"
                ),
                {"id": uuid.uuid4(), "uid": user_id, "day": today},
            )
            await s.commit()
    except Exception as exc:  # never let analytics break a real request
        _activity_seen.pop(user_id, None)  # allow a retry on the next request
        logger.debug("activity record skipped: %s", exc)


def create_access_token(
    subject: str,
    expires_delta: timedelta | None = None,
) -> str:
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode: dict[str, object] = {"sub": subject, "exp": expire}
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_access_token(token: str) -> dict[str, object]:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    payload = decode_access_token(token)
    subject = payload.get("sub")
    if not isinstance(subject, str):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        user_id = uuid.UUID(subject)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )
    await _record_daily_activity(user.id)
    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    """Gate admin-only endpoints. A signed-in non-admin is rejected with 403."""
    if user.email.strip().lower() not in settings.admin_emails:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return user
