from __future__ import annotations

import uuid

from sqlalchemy import func, select

from app.models.library import LibraryBook
from app.repositories.base import BaseRepository


class LibraryRepository(BaseRepository[LibraryBook]):
    def list_for_user(self, *, user_id: uuid.UUID) -> list[LibraryBook]:
        stmt = (
            select(LibraryBook)
            .where(LibraryBook.user_id == user_id)
            .order_by(LibraryBook.last_read_at.desc().nullslast(), LibraryBook.created_at.desc())
        )
        return list(self.db.execute(stmt).scalars().all())

    def get_for_user(self, *, book_id: uuid.UUID, user_id: uuid.UUID) -> LibraryBook | None:
        """Always scoped by owner — there is no lookup by id alone, so a
        guessed id can't reach someone else's file."""
        stmt = select(LibraryBook).where(LibraryBook.id == book_id, LibraryBook.user_id == user_id)
        return self.db.execute(stmt).scalar_one_or_none()

    def list_visible_for_buddy(self, *, owner_id: uuid.UUID) -> list[LibraryBook]:
        stmt = (
            select(LibraryBook)
            .where(LibraryBook.user_id == owner_id, LibraryBook.is_visible_to_buddies.is_(True))
            .order_by(LibraryBook.last_read_at.desc().nullslast(), LibraryBook.created_at.desc())
        )
        return list(self.db.execute(stmt).scalars().all())

    def create(self, **kwargs) -> LibraryBook:
        book = LibraryBook(**kwargs)
        self.db.add(book)
        self.db.commit()
        self.db.refresh(book)
        return book

    def save(self, book: LibraryBook) -> LibraryBook:
        self.db.add(book)
        self.db.commit()
        self.db.refresh(book)
        return book

    def delete(self, book: LibraryBook) -> None:
        self.db.delete(book)
        self.db.commit()

    def count_for_user(self, *, user_id: uuid.UUID) -> int:
        stmt = select(func.count(LibraryBook.id)).where(LibraryBook.user_id == user_id)
        return int(self.db.execute(stmt).scalar() or 0)
