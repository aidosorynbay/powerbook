from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.security import create_access_token, hash_password, verify_password
from app.models.enums import Gender
from app.models.user import User
from app.repositories.users import UserRepository


class AuthService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.users = UserRepository(db)

    def register(self, *, username: str, password: str, display_name: str, gender: Gender, telegram_id: str | None = None) -> tuple[User, str]:
        existing = self.users.get_by_username(username)
        if existing is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already taken")

        try:
            password_hash = hash_password(password)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

        user = self.users.create(
            username=username,
            password_hash=password_hash,
            display_name=display_name,
            gender=gender,
            telegram_id=telegram_id,
        )
        token = create_access_token(subject=str(user.id))
        return user, token

    def login(self, *, login: str, password: str) -> str:
        user = self.users.get_by_login(login)
        if user is None or not user.is_active:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

        if not verify_password(password, user.password_hash):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

        return create_access_token(subject=str(user.id))

