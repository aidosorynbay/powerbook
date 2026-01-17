from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import User
from app.repositories.users import UserRepository


class AuthService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.users = UserRepository(db)

    def register(self, *, email: str, password: str, display_name: str) -> tuple[User, str]:
        existing = self.users.get_by_email(email)
        if existing is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

        user = self.users.create(
            email=email,
            password_hash=hash_password(password),
            display_name=display_name,
        )
        token = create_access_token(subject=str(user.id))
        return user, token

    def login(self, *, email: str, password: str) -> str:
        user = self.users.get_by_email(email)
        if user is None or not user.is_active:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

        if not verify_password(password, user.password_hash):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

        return create_access_token(subject=str(user.id))

