from __future__ import annotations

import hashlib
import hmac
import time

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.security import hash_password, verify_password
from app.db.session import get_db
from app.models.user import User
from app.repositories.users import UserRepository
from app.schemas.auth import ChangePasswordRequest, LoginRequest, RegisterRequest, TelegramResetRequest, TokenResponse, UpdateProfileRequest
from app.schemas.users import UserOut
from app.services.auth import AuthService

TELEGRAM_AUTH_MAX_AGE = 600  # 10 minutes


def _verify_telegram_auth(data: dict, bot_token: str) -> bool:
    """Verify Telegram Login Widget data using HMAC-SHA256."""
    check_hash = data.get("hash", "")
    data_check = {k: v for k, v in data.items() if k not in ("hash", "new_password") and v is not None}
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(data_check.items()))
    secret_key = hashlib.sha256(bot_token.encode()).digest()
    computed = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(computed, check_hash)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse)
def register(payload: RegisterRequest, db: Session = Depends(get_db)) -> TokenResponse:
    _, token = AuthService(db).register(
        username=payload.username,
        password=payload.password,
        display_name=payload.display_name,
        gender=payload.gender,
        telegram_id=payload.telegram_id,
    )
    return TokenResponse(access_token=token)


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    token = AuthService(db).login(login=payload.login, password=payload.password)
    return TokenResponse(access_token=token)


@router.get("/me", response_model=UserOut)
def me(current_user=Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(current_user)


@router.put("/profile", response_model=UserOut)
def update_profile(
    payload: UpdateProfileRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserOut:
    fields = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not fields:
        return UserOut.model_validate(current_user)
    repo = UserRepository(db)
    if "username" in fields and fields["username"] != current_user.username:
        existing = repo.get_by_username(fields["username"])
        if existing and existing.id != current_user.id:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already taken")
    if "email" in fields and fields["email"] != current_user.email:
        existing = repo.get_by_email(fields["email"])
        if existing and existing.id != current_user.id:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already taken")
    user = repo.update(current_user, **fields)
    return UserOut.model_validate(user)


@router.put("/change-password")
def change_password(
    payload: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
    new_hash = hash_password(payload.new_password)
    UserRepository(db).update(current_user, password_hash=new_hash)
    return {"detail": "Password changed"}


@router.post("/reset-password")
def reset_password(payload: TelegramResetRequest, db: Session = Depends(get_db)) -> dict:
    if not settings.telegram_bot_token:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Password reset not configured")

    # Verify Telegram signature
    if not _verify_telegram_auth(payload.model_dump(), settings.telegram_bot_token):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Telegram auth data")

    # Check auth is fresh (within 10 minutes)
    if time.time() - payload.auth_date > TELEGRAM_AUTH_MAX_AGE:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Telegram auth expired, please try again")

    # Find user by Telegram numeric ID
    repo = UserRepository(db)
    user = repo.get_by_telegram_id(str(payload.id))
    if user is None:
        # Also try by username if provided
        if payload.username:
            user = repo.get_by_telegram_id(payload.username)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No account linked to this Telegram")

    repo.update(user, password_hash=hash_password(payload.new_password))
    return {"detail": "Password reset successful"}

