"""Answers under a review: a little flat thread, like a chat.

The founder asked for it on 2026-10-14: the bell said a reader had reviewed
«Мартин Иден», and there was nowhere to say anything back.

Whoever wrote the review hears every answer, and so does everyone who has
answered before (they are in the conversation). Answers that come while a
reader has not opened the bell yet gather into one notification: a lively
thread is one line in the bell, not twenty.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.book_review import BookReview
from app.models.book_review_reply import BookReviewReply
from app.models.enums import SystemRole
from app.models.notification import Notification
from app.models.user import User
from app.services import catalog

logger = logging.getLogger(__name__)

MAX_CHARS = 1000
KIND = "review_reply"


def _out(reply: BookReviewReply, user: User, viewer: User) -> dict:
    return {
        "id": str(reply.id),
        "user_id": str(user.id),
        "display_name": user.display_name or user.username,
        "avatar_data": user.avatar_data,
        "text": reply.text,
        "created_at": reply.created_at,
        "is_viewer": user.id == viewer.id,
        "can_delete": user.id == viewer.id or viewer.system_role in {SystemRole.admin, SystemRole.superadmin},
    }


def _review(db: Session, review_id: uuid.UUID) -> BookReview:
    review = db.get(BookReview, review_id)
    if review is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="review_not_found")
    return review


def counts(db: Session, review_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not review_ids:
        return {}
    return dict(db.execute(
        select(BookReviewReply.review_id, func.count())
        .where(BookReviewReply.review_id.in_(review_ids))
        .group_by(BookReviewReply.review_id)
    ).all())


def thread(db: Session, *, viewer: User, review_id: uuid.UUID) -> list[dict]:
    _review(db, review_id)
    rows = db.execute(
        select(BookReviewReply, User)
        .join(User, User.id == BookReviewReply.user_id)
        .where(BookReviewReply.review_id == review_id)
        .order_by(BookReviewReply.created_at, BookReviewReply.id)
    ).all()
    return [_out(reply, user, viewer) for reply, user in rows]


def add(db: Session, *, user: User, review_id: uuid.UUID, text: str) -> dict:
    review = _review(db, review_id)
    text = (text or "").strip()
    if not text:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="empty_reply")
    reply = BookReviewReply(review_id=review.id, user_id=user.id, text=text[:MAX_CHARS])
    db.add(reply)
    db.commit()
    db.refresh(reply)
    _tell(db, review, reply, user)
    return _out(reply, user, user)


def delete(db: Session, *, user: User, reply_id: uuid.UUID) -> None:
    reply = db.get(BookReviewReply, reply_id)
    admin = user.system_role in {SystemRole.admin, SystemRole.superadmin}
    if reply is None or (reply.user_id != user.id and not admin):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="reply_not_found")
    db.delete(reply)
    db.commit()


def take_back(db: Session, review_id: uuid.UUID) -> None:
    """The review is gone: so is the news of answers to it (the answers go with it)."""
    from sqlalchemy import delete as sql_delete

    try:
        db.execute(sql_delete(Notification).where(Notification.kind == KIND, Notification.dedupe == str(review_id)))
        db.commit()
    except Exception:
        logger.exception("taking back reply notifications failed")
        db.rollback()


def _tell(db: Session, review: BookReview, reply: BookReviewReply, sender: User) -> None:
    """Whoever wrote the review and whoever answered before hear, but the sender."""
    from app.services.notify import _muted, _quote

    try:
        idx = catalog.index(db)
        sender_person = idx.person_of(sender.id)
        talkers = set(db.execute(
            select(BookReviewReply.user_id).where(BookReviewReply.review_id == review.id)
        ).scalars())
        wanted = (talkers | {review.user_id}) - {sender.id}
        if not wanted:
            return
        muted = _muted(db, KIND)
        recipients = [
            uid for uid in db.execute(
                select(User.id).where(User.id.in_(wanted), User.is_active.is_(True), User.is_claimable.is_(False))
            ).scalars()
            if uid not in muted and idx.person_of(uid) != sender_person
        ]
        if not recipients:
            return
        author = db.get(User, review.user_id)
        work = idx.find(review.work_key)
        base = {
            "review_id": str(review.id),
            "work_key": work.key if work else review.work_key,
            "title": review.title,
            "quote": _quote(reply.text),
            "reader": sender.display_name or sender.username,
            "reader_id": str(sender.id),
            "gender": sender.gender.value if sender.gender else None,
            "review_author": (author.display_name or author.username) if author else None,
        }
        unread = {
            n.user_id: n for n in db.execute(
                select(Notification).where(
                    Notification.user_id.in_(recipients),
                    Notification.kind == KIND,
                    Notification.dedupe == str(review.id),
                    Notification.read_at.is_(None),
                )
            ).scalars()
        }
        now = datetime.now(timezone.utc)
        for uid in recipients:
            data = {**base, "mine": uid == review.user_id}
            waiting = unread.get(uid)
            if waiting is not None:
                # Not seen yet: the same line says there is more, and comes back to the top.
                data["n"] = int((waiting.data or {}).get("n", 1)) + 1
                waiting.data = data
                waiting.created_at = now
            else:
                db.add(Notification(user_id=uid, kind=KIND, data={**data, "n": 1}, dedupe=str(review.id)))
        db.commit()
    except Exception:  # never in the way of the answer itself
        logger.exception("reply notifications failed")
        db.rollback()
