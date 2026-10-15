"""The window after a saved day: a mood, a few words, a photo of how the
reader reads. Kept in reader_feedback for /admin; the founder hears of each
one in Telegram (admin_ping.feedback_received)."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.photos import check_photo
from app.models.reader_feedback import ReaderFeedback
from app.models.round import Round
from app.models.user import User

# A reader answers once a month or so; more than this in a day is a stuck
# button or a script, not feedback.
MAX_PER_DAY = 5
# These photos may go into posts and stories, so they come larger than the
# market's: the page sends up to 2048 px, which fits here.
MAX_PHOTO_BYTES = 1_500_000


class FeedbackService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def create(
        self,
        *,
        user: User,
        mood: str | None,
        text: str | None,
        photo: str | None,
        photo_consent: bool,
        round_id: uuid.UUID | None,
        source: str | None,
        locale: str | None,
    ) -> ReaderFeedback:
        text = (text or "").strip() or None
        photo = check_photo(photo, max_bytes=MAX_PHOTO_BYTES)
        if not (mood or text or photo):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="empty_feedback")
        since = datetime.now(timezone.utc) - timedelta(days=1)
        sent = self.db.scalar(
            select(func.count()).select_from(ReaderFeedback).where(
                ReaderFeedback.user_id == user.id, ReaderFeedback.created_at >= since
            )
        )
        if (sent or 0) >= MAX_PER_DAY:
            raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="too_many")
        row = ReaderFeedback(
            user_id=user.id,
            # Only a circle that exists: a stale page must not fail the answer.
            round_id=round_id if round_id and self.db.get(Round, round_id) else None,
            mood=mood,
            text=text,
            photo=photo,
            # The tick means something only with a photo to show.
            photo_consent=bool(photo and photo_consent),
            source=source,
            locale=locale,
        )
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row
