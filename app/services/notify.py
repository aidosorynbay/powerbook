"""«Следить за книгой» and the header bell.

A reader watches a book of the shared library. They hear about it (in the
site's bell; pushes come with the app) when:

- someone puts it on the bazaar («Книжный базар»);
- someone in the circle finishes it, in a day's entry that is not private:
  they might part with it;

and whoever finishes a book that readers are watching hears that, with
the way to sell it, unless they already have it on the bazaar.

Everyone hears when someone writes a review of any book (a mark with no
words is not a review). Each kind can be switched off; no switch means on.

Nothing here may break what triggered it: logging the day's minutes or
putting up a listing always succeeds, whatever happens to a notification.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.orm import Session

from app.models.book_listing import BookListing
from app.models.book_review import BookReview
from app.models.notification import BookWatch, Notification, NotificationPref
from app.models.user import User
from app.services import catalog

logger = logging.getLogger(__name__)

KEEP_DAYS = 90

# Everything the bell says, in the order the settings list them.
KINDS = ("new_review", "watch_listing", "watch_finished", "wanted_by")

# How much of a review the bell quotes.
QUOTE_CHARS = 140


def _now() -> datetime:
    return datetime.now(timezone.utc)


def notify(db: Session, user_id: uuid.UUID, kind: str, data: dict, *, dedupe: str | None = None) -> bool:
    """Add one notification; the same thing (kind + dedupe) twice in a day is said once."""
    if user_id in _muted(db, kind):
        return False
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


# ---------- what each reader wants to hear ----------


def _muted(db: Session, kind: str) -> set[uuid.UUID]:
    return set(db.execute(
        select(NotificationPref.user_id).where(NotificationPref.kind == kind, NotificationPref.enabled.is_(False))
    ).scalars())


def settings(db: Session, user_id: uuid.UUID) -> dict[str, bool]:
    saved = dict(db.execute(
        select(NotificationPref.kind, NotificationPref.enabled).where(NotificationPref.user_id == user_id)
    ).all())
    return {kind: saved.get(kind, True) for kind in KINDS}


def save_settings(db: Session, user_id: uuid.UUID, changes: dict[str, bool]) -> dict[str, bool]:
    for kind, enabled in changes.items():
        if kind not in KINDS:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="unknown_kind")
        row = db.get(NotificationPref, (user_id, kind))
        if row is None:
            db.add(NotificationPref(user_id=user_id, kind=kind, enabled=enabled))
        else:
            row.enabled = enabled
    db.commit()
    return settings(db, user_id)


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


def _quote(text: str) -> str:
    words = " ".join(text.split())
    if len(words) <= QUOTE_CHARS:
        return words
    return words[:QUOTE_CHARS].rsplit(" ", 1)[0].rstrip(",.;:—-") + "…"


def on_review(db: Session, review: BookReview, *, had_text: bool) -> None:
    """Someone wrote a review: every reader hears, but the one who wrote it.

    Only once, when the words first appear: a mark changed from 8 to 9 or a
    sentence fixed says nothing new.
    """
    try:
        text = (review.text or "").strip()
        if had_text or not text:
            return
        reviewer = db.get(User, review.user_id)
        if reviewer is None:
            return
        work = catalog.index(db).find(review.work_key)
        data = {
            "review_id": str(review.id),
            "work_key": work.key if work else review.work_key,
            "title": review.title,
            "rating": review.rating,
            "quote": _quote(text),
            "reader": reviewer.display_name or reviewer.username,
            "reader_id": str(reviewer.id),
            "gender": reviewer.gender.value if reviewer.gender else None,
        }
        muted = _muted(db, "new_review")
        readers = db.execute(
            select(User.id).where(User.id != reviewer.id, User.is_active.is_(True), User.is_claimable.is_(False))
        ).scalars()
        rows = [
            {"user_id": user_id, "kind": "new_review", "data": data, "dedupe": str(review.id)}
            for user_id in readers if user_id not in muted
        ]
        if rows:
            db.execute(insert(Notification), rows)
            db.commit()
    except Exception:  # never in the way of saving the review
        logger.exception("review notifications failed")
        db.rollback()


def take_back_review(db: Session, review_id: uuid.UUID) -> None:
    """The review is gone, or its words are: so is the news of it."""
    try:
        db.execute(delete(Notification).where(Notification.kind == "new_review", Notification.dedupe == str(review_id)))
        db.commit()
    except Exception:
        logger.exception("taking back review notifications failed")
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
