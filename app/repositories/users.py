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

    def get_by_username(self, username: str) -> User | None:
        stmt = select(User).where(User.username == username)
        return self.db.execute(stmt).scalar_one_or_none()

    def get_by_email(self, email: str) -> User | None:
        stmt = select(User).where(User.email == email)
        return self.db.execute(stmt).scalar_one_or_none()

    def get_by_telegram_id(self, telegram_id: str) -> User | None:
        stmt = select(User).where(User.telegram_id == telegram_id)
        return self.db.execute(stmt).scalar_one_or_none()

    def get_by_login(self, login: str) -> User | None:
        """Look up by username first, then telegram_id, then email.

        A leading "@" is dropped before matching. Telegram shows handles that
        way, so people type them that way, and registration already strips it
        before storing — without this, signing in with the same string you
        registered with failed as "invalid credentials".
        """
        login = login.strip()
        handle = login[1:] if login.startswith("@") else login

        user = self.get_by_username(handle)
        if user is None:
            user = self.get_by_telegram_id(handle)
        # An address keeps its "@", which is never in first position.
        if user is None and "@" in login:
            user = self.get_by_email(login)
        return user

    def list(self, *, offset: int = 0, limit: int = 50) -> list[User]:
        stmt = select(User).offset(offset).limit(limit).order_by(User.created_at.desc())
        return list(self.db.execute(stmt).scalars().all())

    def list_real_users(self) -> list[User]:
        """Everyone with a real account (excludes historical-archive ghost
        placeholders) — used for the public directory."""
        stmt = select(User).where(User.is_claimable.is_(False)).order_by(User.display_name.asc())
        return list(self.db.execute(stmt).scalars().all())

    def list_by_person(self, *, person_id: uuid.UUID) -> list[User]:
        """Every archive account belonging to one human."""
        stmt = select(User).where(User.person_id == person_id).order_by(User.username.asc())
        return list(self.db.execute(stmt).scalars().all())

    def get_by_ids(self, user_ids: list[uuid.UUID]) -> dict[uuid.UUID, User]:
        if not user_ids:
            return {}
        stmt = select(User).where(User.id.in_(user_ids))
        return {u.id: u for u in self.db.execute(stmt).scalars().all()}

    def create(
        self,
        *,
        username: str,
        password_hash: str,
        display_name: str,
        gender: Gender,
        telegram_id: str | None = None,
    ) -> User:
        user = User(
            username=username,
            password_hash=password_hash,
            display_name=display_name,
            gender=gender,
            telegram_id=telegram_id,
        )
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        return user

    def update(self, user: User, **fields: object) -> User:
        for key, value in fields.items():
            setattr(user, key, value)
        self.db.commit()
        self.db.refresh(user)
        return user

