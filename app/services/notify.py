"""«Следить за книгой» and the header bell.

A reader watches a book of the shared library. They hear about it (in the
site's bell; pushes come with the app) when:

- someone puts it on the bazaar («Книжный базар»);
- someone in the circle finishes it, in a day's entry that is not private:
  they might part with it;

and whoever finishes a book that readers are watching hears that, with
the way to sell it, unless they already have it on the bazaar.

Nothing here may break what triggered it: logging the day's minutes or
putting up a listing always succeeds, whatever happens to a notification.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.models.book_listing import BookListing
from app.models.notification import BookWatch, Notification
from app.models.user import User
from app.services import catalog

logger = logging.getLogger(__name__)

KEEP_DAYS = 90


def _now() -> datetime:
    return datetime.now(timezone.utc)


def notify(db: Session, user_id: uuid.UUID, kind: str, data: dict, *, dedupe: str | None = None) -> bool:
    """Add one notification; the same thing (kind + dedupe) twice in a day is said once."""
    if dedupe:
        seen = db.execute(
            select(Notification.id).where(
                Notification.user_id == user_id,
                Notification.kind == kind,
                Notification.dedupe == dedupe,
                Notification.created_at >= _now() - timedelta(days=1),
            )
        ).first()
        if seen:
            return False
    db.add(Notification(user_id=user_id, kind=kind, data=data, dedupe=dedupe))
    return True


# ---------- watching ----------


def _work(db: Session, key: str):
    work = catalog.index(db).find(key)
    if work is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="book_not_found")
    return work


def watch(db: Session, *, user: User, key: str) -> dict:
    work = _work(db, key)
    row = db.get(BookWatch, (user.id, work.key))
    if row is None:
        db.add(BookWatch(user_id=user.id, work_key=work.key, title=work.title[:300]))
        db.commit()
    return {"watching": True, "watchers": watchers_count(db, work)}


def unwatch(db: Session, *, user: User, key: str) -> dict:
    work = catalog.index(db).find(key)
    keys = list(work.members | {work.key}) if work else [key]
    rows = db.execute(select(BookWatch).where(BookWatch.user_id == user.id, BookWatch.work_key.in_(keys))).scalars().all()
    for row in rows:
        db.delete(row)
    db.commit()
    return {"watching": False, "watchers": watchers_count(db, work) if work else 0}


def _watchers(db: Session, work) -> list[uuid.UUID]:
    """Who watches this book, under any key it is known by."""
    keys = list(work.members | {work.key})
    return [row[0] for row in db.execute(select(BookWatch.user_id).where(BookWatch.work_key.in_(keys))).all()]


def watchers_count(db: Session, work) -> int:
    return len(set(_watchers(db, work)))


def is_watching(db: Session, user_id: uuid.UUID, work) -> bool:
    keys = list(work.members | {work.key})
    return db.execute(select(BookWatch.user_id).where(BookWatch.user_id == user_id, BookWatch.work_key.in_(keys))).first() is not None


def watches_for(db: Session, user_id: uuid.UUID) -> list[dict]:
    idx = catalog.index(db)
    out = []
    for row in db.execute(select(BookWatch).where(BookWatch.user_id == user_id).order_by(BookWatch.created_at.desc())).scalars():
        work = idx.find(row.work_key)
        on_sale = 0
        if work is not None:
            on_sale = db.execute(
                select(func.count()).where(BookListing.work_key.in_(list(work.members | {work.key})), BookListing.status == "active")
            ).scalar_one()
        out.append({"work_key": work.key if work else row.work_key, "title": work.title if work else row.title,
                    "author": work.author if work else None, "for_sale": on_sale})
    return out


# ---------- what sets the bell off ----------


def on_listing(db: Session, listing: BookListing) -> None:
    """A book went on the bazaar: everyone watching it hears, but the seller."""
    try:
        if listing.status != "active" or not listing.work_key:
            return
        work = catalog.index(db).find(listing.work_key)
        if work is None:
            return
        seller = db.get(User, listing.seller_id)
        sent = 0
        for user_id in set(_watchers(db, work)):
            if user_id == listing.seller_id:
                continue
            sent += notify(db, user_id, "watch_listing", {
                "listing_id": str(listing.id),
                "work_key": work.key,
                "title": work.title,
                "price": listing.price,
                "city": listing.city,
                "seller": (seller.display_name or seller.username) if seller else None,
            }, dedupe=str(listing.id))
        if sent:
            db.commit()
    except Exception:  # never in the way of putting up a listing
        logger.exception("listing notifications failed")
        db.rollback()


def on_finished(db: Session, *, reader_id: uuid.UUID, comment: str | None, day=None) -> None:
    """Someone in the circle finished a book (in a day's entry that is not
    private): those watching it hear; and if anyone is watching, so does the
    reader, with the way to sell it."""
    from app.core.booktitles import matching_key
    from app.repositories.insights import normalize_book_title
    from app.services.bookcase import _short_hash

    try:
        if not comment:
            return
        key = matching_key(comment)
        work = catalog.index(db).find(key) if key else None
        if work is None:
            return
        idx = catalog.index(db)
        reader = db.get(User, reader_id)
        me = idx.person_of(reader_id)
        watchers = {u for u in _watchers(db, work) if idx.person_of(u) != me}
        if not watchers:
            return
        name = (reader.display_name or reader.username) if reader else None
        for user_id in watchers:
            notify(db, user_id, "watch_finished", {
                "work_key": work.key, "title": work.title, "reader": name, "reader_id": str(reader_id),
            }, dedupe=f"{work.key}:{reader_id}")
        selling = db.execute(
            select(BookListing.id).where(
                BookListing.seller_id == reader_id,
                BookListing.work_key.in_(list(work.members | {work.key})),
                BookListing.status.in_(("active", "reserved")),
            )
        ).first()
        if not selling:
            notify(db, reader_id, "wanted_by", {
                "work_key": work.key,
                "title": work.title,
                "author": work.author,
                "n": len(watchers),
                # the key this book has on the reader's shelf, for «Продать»
                "volume_key": f"r:{_short_hash(normalize_book_title(comment))}",
            }, dedupe=work.key)
        db.commit()
    except Exception:  # never in the way of logging the day
        logger.exception("finish notifications failed")
        db.rollback()


# ---------- the bell ----------


def unread_count(db: Session, user_id: uuid.UUID) -> int:
    return db.execute(
        select(func.count()).where(Notification.user_id == user_id, Notification.read_at.is_(None))
    ).scalar_one()


def recent(db: Session, user_id: uuid.UUID, limit: int = 30) -> list[dict]:
    rows = db.execute(
        select(Notification)
        .where(Notification.user_id == user_id, Notification.created_at >= _now() - timedelta(days=KEEP_DAYS))
        .order_by(Notification.created_at.desc())
        .limit(limit)
    ).scalars().all()
    return [
        {"id": str(r.id), "kind": r.kind, "data": r.data or {}, "created_at": r.created_at.isoformat() if r.created_at else None,
         "read": r.read_at is not None}
        for r in rows
    ]


def mark_read(db: Session, user_id: uuid.UUID, ids: list[uuid.UUID] | None = None) -> None:
    stmt = update(Notification).where(Notification.user_id == user_id, Notification.read_at.is_(None))
    if ids:
        stmt = stmt.where(Notification.id.in_(ids))
    db.execute(stmt.values(read_at=_now()))
    db.commit()
