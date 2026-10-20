"""«Хочу прочитать»: a reader's second shelf, of books to read later — and «Прочитал(а)», its other choice.

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


def reattach_mark(db: Session, user_id: uuid.UUID, title: str, volume_key: str) -> None:
    """A book back on the shelf takes back the reader's mark of it: one mark per reader and book, never a second one.
    Only a mark whose own copy is gone moves; a mark on another copy still on the shelf stays there."""
    from app.models.book_review import BookReview
    from app.services.bookcase import BookcaseService

    idx = catalog.index(db)
    work = book_face.work_of(idx, title=title)
    if work is None:
        return
    shelf = {b.key for b in BookcaseService(db).bookcase(owner_id=user_id, viewer_id=user_id).books if not b.hidden}
    changed = False
    for review in db.execute(select(BookReview).where(BookReview.user_id == user_id)).scalars():
        if review.volume_key in shelf and review.volume_key != volume_key:
            continue
        if review.work_key == work.key or book_face.work_of(idx, review.work_key, title=review.title) is work:
            review.volume_key, review.work_key = volume_key, work.key
            changed = True
    if changed:
        db.commit()


def add_read(db: Session, user_id: uuid.UUID, *, title: str, author: str | None, work_key: str | None) -> str:
    """«Прочитал(а)» from a book's card: the reader's copy on the read shelf, whatever brought it there before.

    A copy they took off the shelf comes back (a book finished in a circle keeps its day); a copy already there is
    left as it is; else the book is added by hand. Its mark comes back to it, and it leaves «Хочу прочитать».
    Returns the copy's key on the shelf."""
    from app.schemas.insights import ManualBookIn
    from app.services import shelf_overrides
    from app.services.bookcase import BookcaseService
    from app.services.insights import InsightsService

    title = (title or "").strip()
    if not title:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="title_required")
    idx = catalog.index(db)
    work = book_face.work_of(idx, work_key, title=title)
    shelf = BookcaseService(db).bookcase(owner_id=user_id, viewer_id=user_id).books
    mine = [b for b in shelf if b.status == "finished" and work is not None and b.work_key == work.key]
    copy = next((b for b in mine if not b.hidden), None) or next(iter(mine), None)
    if copy is not None:
        if copy.hidden:
            shelf_overrides.set_hidden(db, user_id, copy.key, False)
        key = copy.key
    else:
        try:
            book = InsightsService(db).add_manual_book(
                user_id=user_id, payload=ManualBookIn(title=title, author=author or None, finished_on=None)
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
        key = f"m:{book.id}"
    reattach_mark(db, user_id, (work.title if work is not None else title), key)
    # read now: off the list of books to read
    idx = catalog.index(db)
    work = book_face.work_of(idx, work_key, title=title)
    for row in db.execute(select(WantBook).where(WantBook.user_id == user_id)).scalars():
        if work is not None and (row.work_key == work.key or book_face.work_of(idx, row.work_key, title=row.title) is work):
            db.delete(row)
    db.commit()
    return key
