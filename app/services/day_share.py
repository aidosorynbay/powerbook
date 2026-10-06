"""Sharing a reading day, the way runners post a run from Strava.

A reader who has read today sends the day out: a short text with the round
drawn in squares and a link to their day page, /r/<username>. The page is what
a friend sees — the minutes, the run of days, the round so far — and the way
into the next circle. Whoever signs up from it is remembered as that reader's
guest (users.invited_by).

Nobody's page is open until they have shared a day themselves, and it shows
minutes only: never what was read, never a comment.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.constants import DEFAULT_GROUP_SLUG, ROUND_TZ
from app.models.day_share import DayShare
from app.models.enums import RoundParticipantStatus
from app.models.group import Group
from app.models.reading_room import ReadingRoomSession
from app.models.round import ReadingLog, ReadingLogBook, Round, RoundParticipant
from app.models.sticker_use import StickerUse
from app.models.user import User
from app.schemas.share import CardDayOut, DayCardOut, MyDayCardOut

_IN_ROUND = (RoundParticipantStatus.active, RoundParticipantStatus.locked)


def _today() -> date:
    return datetime.now(tz=ROUND_TZ).date()


def _not_found(detail: str = "not_shared") -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


def _card(db: Session, *, user: User, rnd: Round, day: date) -> dict:
    """The round as the share shows it, up to `day` (kept inside the round)."""
    first, last = rnd.first_day_date, rnd.last_day_date
    day = min(max(day, first), last)
    rows = db.execute(
        select(ReadingLog.date, ReadingLog.minutes, ReadingLog.score).where(
            ReadingLog.round_id == rnd.id, ReadingLog.user_id == user.id
        )
    ).all()
    logged = {d: (int(m), int(s)) for d, m, s in rows}

    days: list[CardDayOut] = []
    d = first
    while d <= last:
        minutes, score = logged.get(d, (0, 0))
        days.append(CardDayOut(date=d, minutes=minutes, score=score))
        d += timedelta(days=1)

    # Days of 30+ minutes in a row, counted back from the card's day, the way
    # the round page counts them: the day itself, while short of 30, is still
    # going on and breaks nothing.
    streak = 0
    d = day
    while d >= first:
        if logged.get(d, (0, 0))[1] == 1:
            streak += 1
        elif d != day:
            break
        d -= timedelta(days=1)

    so_far = [x for x in days if x.date <= day]
    return dict(
        username=user.username,
        display_name=user.display_name,
        avatar_data=user.avatar_data,
        year=rnd.year,
        month=rnd.month,
        first_day=first,
        last_day=last,
        day=day,
        day_number=(day - first).days + 1,
        minutes=logged.get(day, (0, 0))[0],
        streak=streak,
        goal_days=sum(x.score for x in so_far),
        total_minutes=sum(x.minutes for x in so_far),
        days=days,
    )


def _round(db: Session, round_id: str) -> Round:
    try:
        rnd = db.get(Round, uuid.UUID(round_id))
    except ValueError:
        rnd = None
    if rnd is None:
        raise _not_found("Round not found")
    return rnd


def _round_for(db: Session, day: date) -> Round | None:
    """The circle's round for the month a day falls in."""
    group = db.execute(select(Group).where(Group.slug == DEFAULT_GROUP_SLUG)).scalar_one_or_none()
    if group is None:
        return None
    return db.execute(
        select(Round).where(Round.group_id == group.id, Round.year == day.year, Round.month == day.month)
    ).scalar_one_or_none()


def _book(db: Session, *, user: User, rnd: Round, day: date) -> str | None:
    """The book the reader is on by `day`, for the title on their sticker: the
    latest day's book with the most minutes, from «Что читаю» or from a sitting
    in the reading room. A day logged without a book keeps the one before it."""
    logged = db.execute(
        select(ReadingLog.date, ReadingLogBook.minutes, ReadingLogBook.title)
        .join(ReadingLogBook, ReadingLogBook.reading_log_id == ReadingLog.id)
        .where(ReadingLog.round_id == rnd.id, ReadingLog.user_id == user.id, ReadingLog.date <= day)
        .order_by(ReadingLog.date.desc(), ReadingLogBook.minutes.desc(), ReadingLogBook.position)
        .limit(1)
    ).first()
    sat = db.execute(
        select(ReadingRoomSession.credited_date, ReadingRoomSession.credited_minutes, ReadingRoomSession.book_title)
        .where(
            ReadingRoomSession.user_id == user.id,
            ReadingRoomSession.credited_round_id == rnd.id,
            ReadingRoomSession.credited_date <= day,
            ReadingRoomSession.credited_minutes > 0,
        )
        .order_by(ReadingRoomSession.credited_date.desc(), ReadingRoomSession.credited_minutes.desc())
        .limit(1)
    ).first()
    found = [row for row in (logged, sat) if row is not None and row[2].strip()]
    if not found:
        return None
    return max(found, key=lambda row: (row[0], row[1]))[2].strip()


def my_card(db: Session, *, user: User, day: date, round_id: str | None = None) -> MyDayCardOut:
    """The reader's own day, for the text they are about to send. `day` is
    the reader's own date: the page knows it better than the server does."""
    rnd = _round(db, round_id) if round_id else _round_for(db, day)
    if rnd is None:
        raise _not_found("Round not found")
    invited = db.execute(select(func.count()).select_from(User).where(User.invited_by == user.id)).scalar_one()
    card = _card(db, user=user, rnd=rnd, day=day)
    return MyDayCardOut(
        **card, round_id=str(rnd.id), invited=int(invited), book=_book(db, user=user, rnd=rnd, day=card["day"])
    )


def share(
    db: Session,
    *,
    user: User,
    round_id: str,
    day: date,
    channel: str,
    template: str | None = None,
    action: str | None = None,
    ink: str | None = None,
) -> None:
    rnd = _round(db, round_id)
    if not rnd.covers(day):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Day is outside this round")
    in_round = db.execute(
        select(RoundParticipant.id).where(
            RoundParticipant.round_id == rnd.id,
            RoundParticipant.user_id == user.id,
            RoundParticipant.status.in_(_IN_ROUND),
        )
    ).first()
    if in_round is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a participant")

    # Every sticker taken is counted, not just the day's first.
    if template is not None:
        db.add(StickerUse(
            user_id=user.id, round_id=rnd.id, day=day, channel=channel, template=template,
            action=action or "copy", ink=ink or "light",
        ))
        db.commit()

    seen = db.execute(
        select(DayShare.id).where(DayShare.user_id == user.id, DayShare.day == day, DayShare.channel == channel)
    ).first()
    if seen is not None:
        return
    db.add(DayShare(user_id=user.id, round_id=rnd.id, day=day, channel=channel))
    try:
        db.commit()
    except IntegrityError:
        # The same share sent twice at once: one row is all it needs.
        db.rollback()


def _reader(db: Session, username: str) -> User | None:
    name = username.strip().lstrip("@").lower()
    found = db.execute(select(User).where(User.username == name)).scalar_one_or_none()
    if found is None:
        # Archive-era names were written down as they came, in any case.
        found = db.execute(select(User).where(func.lower(User.username) == name)).scalars().first()
    return found


def public_card(db: Session, *, username: str) -> DayCardOut:
    """What a shared link leads to: the reader's round, up to today."""
    user = _reader(db, username)
    if user is None or not user.is_active or user.is_claimable:
        raise _not_found()
    last = db.execute(
        select(DayShare)
        .where(DayShare.user_id == user.id)
        .order_by(DayShare.created_at.desc(), DayShare.day.desc())
        .limit(1)
    ).scalar_one_or_none()
    if last is None:
        raise _not_found()
    rnd = db.get(Round, last.round_id)
    if rnd is None:
        raise _not_found()
    # Today in the circle's timezone, or a later day the reader has already
    # logged: east of Almaty, a reader's tomorrow comes first.
    latest = db.execute(
        select(func.max(ReadingLog.date)).where(ReadingLog.round_id == rnd.id, ReadingLog.user_id == user.id)
    ).scalar()
    day = max(_today(), latest) if latest else _today()
    return DayCardOut(**_card(db, user=user, rnd=rnd, day=day))
