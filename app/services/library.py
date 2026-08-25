from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core import storage
from app.models.library import LibraryBook
from app.repositories.buddies import BuddyRepository
from app.repositories.library import LibraryRepository
from app.schemas.library import LibraryBookOut, LibraryStatsOut, ShelfBookOut

MAX_FILE_BYTES = settings.library_max_file_mb * 1024 * 1024
QUOTA_BYTES = settings.library_quota_mb * 1024 * 1024

# Read in chunks so a 50 MB upload never sits in memory in one piece — this
# box has ~1.6 GB free and a handful of concurrent uploads would otherwise
# be enough to matter.
CHUNK = 1024 * 1024


class LibraryService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.repo = LibraryRepository(db)
        self.buddies = BuddyRepository(db)

    # ---------- reading ----------

    def list_books(self, *, user_id: uuid.UUID) -> list[LibraryBookOut]:
        return [LibraryBookOut.model_validate(b) for b in self.repo.list_for_user(user_id=user_id)]

    def get_book(self, *, book_id: uuid.UUID, user_id: uuid.UUID) -> LibraryBook:
        book = self.repo.get_for_user(book_id=book_id, user_id=user_id)
        if book is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Book not found")
        return book

    def file_path_for(self, *, book_id: uuid.UUID, user_id: uuid.UUID) -> tuple[Path, LibraryBook]:
        book = self.get_book(book_id=book_id, user_id=user_id)
        try:
            path = storage.resolve(book.file_key)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
        if not path.exists():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
        return path, book

    # ---------- uploading ----------

    def upload(self, *, user_id: uuid.UUID, file: UploadFile, title: str | None, author: str | None) -> LibraryBookOut:
        suffix = Path(file.filename or "").suffix.lower().lstrip(".")
        if suffix not in storage.ALLOWED_FORMATS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Only PDF and EPUB files are supported",
            )

        used = storage.used_bytes(user_id)
        if used >= QUOTA_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="Library is full — delete a book to free up space",
            )

        book_id = uuid.uuid4()
        file_key = storage.build_key(user_id=user_id, book_id=book_id, file_format=suffix)

        # Stream to disk while counting, and abort the moment either limit is
        # crossed. Checking Content-Length instead would trust the client.
        written = 0
        try:
            path = storage.resolve(file_key)
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("wb") as target:
                while chunk := file.file.read(CHUNK):
                    written += len(chunk)
                    if written > MAX_FILE_BYTES:
                        raise HTTPException(
                            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            detail=f"File is larger than {settings.library_max_file_mb} MB",
                        )
                    if used + written > QUOTA_BYTES:
                        raise HTTPException(
                            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            detail="Not enough space left in your library",
                        )
                    target.write(chunk)
        except HTTPException:
            storage.delete(file_key)
            raise
        except OSError:
            storage.delete(file_key)
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Could not store the file")

        fallback_title = Path(file.filename or "Untitled").stem[:300]
        book = self.repo.create(
            id=book_id,
            user_id=user_id,
            title=(title or fallback_title).strip()[:300] or fallback_title,
            author=(author or None),
            file_format=suffix,
            file_key=file_key,
            file_size=written,
        )
        return LibraryBookOut.model_validate(book)

    # ---------- mutating ----------

    def update_book(self, *, book_id: uuid.UUID, user_id: uuid.UUID, **fields) -> LibraryBookOut:
        book = self.get_book(book_id=book_id, user_id=user_id)
        for key, value in fields.items():
            if value is not None:
                setattr(book, key, value)
        return LibraryBookOut.model_validate(self.repo.save(book))

    def save_progress(self, *, book_id: uuid.UUID, user_id: uuid.UUID, percent: int, position: str | None) -> LibraryBookOut:
        book = self.get_book(book_id=book_id, user_id=user_id)
        # Never walk progress backwards on percent: a device that opens the
        # book and reports page 1 before syncing shouldn't wipe the real
        # position set from another device.
        book.progress_percent = max(book.progress_percent, percent)
        if position is not None:
            book.progress_position = position
        book.last_read_at = datetime.now(tz=timezone.utc)
        return LibraryBookOut.model_validate(self.repo.save(book))

    def delete_book(self, *, book_id: uuid.UUID, user_id: uuid.UUID) -> None:
        book = self.get_book(book_id=book_id, user_id=user_id)
        file_key = book.file_key
        self.repo.delete(book)
        storage.delete(file_key)

    # ---------- stats & showcase ----------

    def stats(self, *, user_id: uuid.UUID) -> LibraryStatsOut:
        books = self.repo.list_for_user(user_id=user_id)
        finished = sum(1 for b in books if b.progress_percent >= 100)
        started = sum(1 for b in books if 0 < b.progress_percent < 100)
        return LibraryStatsOut(
            total_books=len(books),
            finished_books=finished,
            in_progress_books=started,
            not_started_books=len(books) - finished - started,
            average_percent=int(round(sum(b.progress_percent for b in books) / len(books))) if books else 0,
            storage_used_bytes=storage.used_bytes(user_id),
            storage_quota_bytes=QUOTA_BYTES,
        )

    def shelf_of(self, *, owner_id: uuid.UUID, viewer_id: uuid.UUID) -> list[ShelfBookOut]:
        """Someone else's shelf: titles and progress, never files.

        Own shelf is always visible; anyone else only sees books the owner
        left visible to buddies.
        """
        if owner_id == viewer_id:
            books = self.repo.list_for_user(user_id=owner_id)
        else:
            books = self.repo.list_visible_for_buddy(owner_id=owner_id)
        return [
            ShelfBookOut(
                title=b.title,
                author=b.author,
                file_format=b.file_format,
                cover_data=b.cover_data,
                progress_percent=b.progress_percent,
                last_read_at=b.last_read_at,
            )
            for b in books
        ]
