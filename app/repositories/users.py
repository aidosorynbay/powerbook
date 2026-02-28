from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.enums import Gender
from app.models.user import User
from app.repositories.base import BaseRepository


class UserRepository(BaseRepository[User]):
    def __init__(self, db: Session) -> None:
        super().__init__(db)

    def get(self, user_id: uuid.UUID) -> User | None:
        return self.db.get(User, user_id)

    def get_by_email(self, email: str) -> User | None:
        stmt = select(User).where(User.email == email)
        return self.db.execute(stmt).scalar_one_or_none()

    def list(self, *, offset: int = 0, limit: int = 50) -> list[User]:
        stmt = select(User).offset(offset).limit(limit).order_by(User.created_at.desc())
        return list(self.db.execute(stmt).scalars().all())

    def get_by_ids(self, user_ids: list[uuid.UUID]) -> dict[uuid.UUID, User]:
        if not user_ids:
            return {}
        stmt = select(User).where(User.id.in_(user_ids))
        return {u.id: u for u in self.db.execute(stmt).scalars().all()}

    def create(
        self,
        *,
        email: str,
        password_hash: str,
        display_name: str,
        gender: Gender,
        telegram_id: str | None = None,
    ) -> User:
        user = User(
            email=email,
            password_hash=password_hash,
            display_name=display_name,
            gender=gender,
            telegram_id=telegram_id,
        )
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        return user

