from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.repositories.suggestions import SuggestionRepository
from app.schemas.suggestions import SuggestionOut


class SuggestionService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.repo = SuggestionRepository(db)

    def create(self, *, name: str | None, message: str, user_id: uuid.UUID | None) -> SuggestionOut:
        row = self.repo.create(name=name, message=message, user_id=user_id)
        return SuggestionOut(
            id=row.id,
            name=row.name,
            message=row.message,
            author_display_name=row.user.display_name if row.user else None,
            created_at=row.created_at,
        )

    def list_all(self) -> list[SuggestionOut]:
        rows = self.repo.list_all()
        return [
            SuggestionOut(
                id=row.id,
                name=row.name,
                message=row.message,
                author_display_name=row.user.display_name if row.user else None,
                created_at=row.created_at,
            )
            for row in rows
        ]
