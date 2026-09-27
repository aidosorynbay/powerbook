"""A reader's notes on the books on their shelf.

Keyed like shelf_overrides, by the volume's key on the bookcase, and only
ever read or written by the shelf's owner.
"""

from __future__ import annotations

import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.book_note import BookNote
from app.services.shelf_overrides import VOLUME_KEY

MAX_LENGTH = 4000
# Enough for a reading life; a runaway client cannot fill the table.
MAX_PER_BOOK = 200


def _clean(text: str) -> str:
    cleaned = (text or "").strip()
    if not cleaned:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="empty_note")
    return cleaned[:MAX_LENGTH]


def notes_for(db: Session, user_id: uuid.UUID) -> dict[str, list[BookNote]]:
    """Every note the reader has, grouped by book, oldest first."""
    rows = db.execute(
        select(BookNote).where(BookNote.user_id == user_id).order_by(BookNote.created_at, BookNote.id)
    ).scalars().all()
    grouped: dict[str, list[BookNote]] = {}
    for row in rows:
        grouped.setdefault(row.volume_key, []).append(row)
    return grouped


def add(db: Session, user_id: uuid.UUID, volume_key: str, text: str) -> BookNote:
    if not VOLUME_KEY.match(volume_key):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="bad_volume")
    count = len(
        db.execute(
            select(BookNote.id).where(BookNote.user_id == user_id, BookNote.volume_key == volume_key)
        ).all()
    )
    if count >= MAX_PER_BOOK:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="too_many_notes")
    note = BookNote(user_id=user_id, volume_key=volume_key, text=_clean(text))
    db.add(note)
    db.commit()
    db.refresh(note)
    return note


def _own(db: Session, user_id: uuid.UUID, note_id: uuid.UUID) -> BookNote:
    note = db.get(BookNote, note_id)
    # Someone else's note reads as missing, not forbidden: its existence is private too.
    if note is None or note.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="note_not_found")
    return note


def update(db: Session, user_id: uuid.UUID, note_id: uuid.UUID, text: str) -> BookNote:
    note = _own(db, user_id, note_id)
    note.text = _clean(text)
    db.commit()
    db.refresh(note)
    return note


def delete(db: Session, user_id: uuid.UUID, note_id: uuid.UUID) -> None:
    db.delete(_own(db, user_id, note_id))
    db.commit()
