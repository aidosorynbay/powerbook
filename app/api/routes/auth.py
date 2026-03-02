from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.security import hash_password, verify_password
from app.db.session import get_db
from app.models.user import User
from app.repositories.users import UserRepository
from app.schemas.auth import ChangePasswordRequest, LoginRequest, RegisterRequest, TokenResponse, UpdateProfileRequest
from app.schemas.users import UserOut
from app.services.auth import AuthService

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

