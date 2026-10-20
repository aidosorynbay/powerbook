"""«Хочу прочитать»: a reader's second shelf, of books to read later.

The founder (2026-10-21): from the shared library a book goes either among the read ones or here. Nothing here counts
as read: the shelf, its count, the fellow readers and the shared library are built from the read shelf alone, and this
module only reads them. A book leaves this list by itself once it is on the read shelf.
"""
from __future__ import annotations

import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.want_book import WantBook
from app.repositories.claims import ClaimsRepository
from app.repositories.insights import normalize_book_title
from app.schemas.library import WantBookOut
from app.services import book_face, catalog


def _norm(title: str) -> str:
    return (normalize_book_title(title) or title.strip().casefold())[:300]


def _read(work: catalog.Work | None, accounts: set[uuid.UUID]) -> bool:
    """On the reader's read shelf (finished in a circle, added by hand as read, or marked)."""
    return work is not None and any(acc in accounts for acc in work.holders)


def mine(db: Session, user_id: uuid.UUID) -> list[WantBookOut]:
    """The list, newest first, each book in the shared library's face; the ones read since are left out."""
    idx = catalog.index(db)
    accounts = set(ClaimsRepository(db).effective_user_ids(user_id=user_id))
    rows = db.execute(select(WantBook).where(WantBook.user_id == user_id).order_by(WantBook.created_at.desc())).scalars()
    out = []
    for row in rows:
        work = book_face.work_of(idx, row.work_key, title=row.title)
        if _read(work, accounts):
            continue
        face = book_face.face(work, row.title) if work is not None else None
        out.append(
            WantBookOut(
                id=str(row.id),
                title=face.title if face else row.title,
                author=(face.author if face else None) or row.author,
                cover_url=face.cover_url if face else None,
                cover_thumb_url=face.cover_thumb_url if face else None,
                work_key=work.key if work is not None else None,
                added_at=row.created_at.date().isoformat() if row.created_at else None,
            )
        )
    return out


def wanted(db: Session, user_id: uuid.UUID, work: catalog.Work) -> str | None:
    """The id of this book in the reader's list, when it is there."""
    idx = catalog.index(db)
    for row in db.execute(select(WantBook).where(WantBook.user_id == user_id)).scalars():
        if row.work_key == work.key or book_face.work_of(idx, row.work_key, title=row.title) is work:
            return str(row.id)
    return None


def add(db: Session, user_id: uuid.UUID, *, title: str, author: str | None, work_key: str | None) -> str:
    """Put a book on the list; a book already there stays as it is."""
    title = (title or "").strip()
    if not title:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="title_required")
    idx = catalog.index(db)
    work = book_face.work_of(idx, work_key, title=title)
    if work is not None:
        same = wanted(db, user_id, work)
        if same:
            return same
    norm = _norm(title)
    row = db.execute(select(WantBook).where(WantBook.user_id == user_id, WantBook.title_norm == norm)).scalar_one_or_none()
    if row is None:
        row = WantBook(
            user_id=user_id, title=title[:300], title_norm=norm, author=(author or "").strip()[:200] or None,
            work_key=work.key if work is not None else None,
        )
        db.add(row)
        db.commit()
    return str(row.id)


def remove(db: Session, user_id: uuid.UUID, want_id: uuid.UUID) -> None:
    row = db.get(WantBook, want_id)
    if row is None or row.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not_found")
    db.delete(row)
    db.commit()
