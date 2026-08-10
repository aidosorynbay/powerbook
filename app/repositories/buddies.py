from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.buddy import ReadingBuddy
from app.repositories.base import BaseRepository


class BuddyRepository(BaseRepository[ReadingBuddy]):
    def __init__(self, db: Session) -> None:
        super().__init__(db)

    def get(self, *, user_id: uuid.UUID, buddy_user_id: uuid.UUID) -> ReadingBuddy | None:
        stmt = select(ReadingBuddy).where(
            ReadingBuddy.user_id == user_id, ReadingBuddy.buddy_user_id == buddy_user_id
        )
        return self.db.execute(stmt).scalar_one_or_none()

    def list_for_user(self, *, user_id: uuid.UUID) -> list[ReadingBuddy]:
        stmt = select(ReadingBuddy).where(ReadingBuddy.user_id == user_id).order_by(ReadingBuddy.created_at.desc())
        return list(self.db.execute(stmt).scalars().all())

    def create(self, *, user_id: uuid.UUID, buddy_user_id: uuid.UUID) -> ReadingBuddy:
        row = ReadingBuddy(user_id=user_id, buddy_user_id=buddy_user_id)
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row

    def delete(self, *, user_id: uuid.UUID, buddy_user_id: uuid.UUID) -> bool:
        row = self.get(user_id=user_id, buddy_user_id=buddy_user_id)
        if row is None:
            return False
        self.db.delete(row)
        self.db.commit()
        return True
