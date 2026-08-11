from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.suggestion import Suggestion
from app.repositories.base import BaseRepository


class SuggestionRepository(BaseRepository[Suggestion]):
    def __init__(self, db: Session) -> None:
        super().__init__(db)

    def create(self, *, name: str | None, message: str, user_id: uuid.UUID | None) -> Suggestion:
        row = Suggestion(name=name, message=message, user_id=user_id)
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row

    def list_all(self) -> list[Suggestion]:
        stmt = select(Suggestion).order_by(Suggestion.created_at.desc())
        return list(self.db.execute(stmt).scalars().all())
