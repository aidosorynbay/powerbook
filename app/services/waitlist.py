"""Getting people into the next circle.

A month has two phases for someone who is not reading in the current round:

  * sign-up is open — the month's first days (until registration_open_until_day)
    and, from the evening of the last day, next month's freshly opened round:
    they are offered the round itself;
  * sign-up is closed — the rest of the month: they can join the waiting list
    for next month's circle, and invite friends to it with a link.

When sign-up for a month opens, everyone waiting for it is offered their place
in one tap. Nobody is put into a round without saying yes: a round ends in a
book exchange, and that is a promise a reader makes themselves.
"""
from __future__ import annotations

import calendar
import uuid
from datetime import date, datetime

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.constants import DEFAULT_GROUP_SLUG, ROUND_TZ
from app.models.enums import RoundParticipantStatus, RoundStatus
from app.models.group import Group
from app.models.round import Round, RoundParticipant
from app.models.user import User
from app.models.waitlist import WaitlistEntry
from app.schemas.waitlist import OpenRoundOut, WaitingPersonOut, WaitlistStateOut

_IN_ROUND = (RoundParticipantStatus.active, RoundParticipantStatus.locked)
_SHOWN_PEOPLE = 12


def _today() -> date:
    return datetime.now(tz=ROUND_TZ).date()


def _next(year: int, month: int) -> tuple[int, int]:
    return (year + 1, 1) if month == 12 else (year, month + 1)


def _group(db: Session) -> Group:
    group = db.execute(select(Group).where(Group.slug == DEFAULT_GROUP_SLUG)).scalar_one_or_none()
    if group is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
    return group


def _round(db: Session, group: Group, year: int, month: int) -> Round | None:
    return db.execute(
        select(Round).where(Round.group_id == group.id, Round.year == year, Round.month == month)
    ).scalar_one_or_none()


def _in_round(db: Session, rnd: Round | None, user: User | None) -> bool:
    if rnd is None or user is None:
        return False
    return (
        db.execute(
            select(RoundParticipant.id).where(
                RoundParticipant.round_id == rnd.id,
                RoundParticipant.user_id == user.id,
                RoundParticipant.status.in_(_IN_ROUND),
            )
        ).first()
        is not None
    )


def _registration_until(rnd: Round) -> date:
    last = calendar.monthrange(rnd.year, rnd.month)[1]
    return date(rnd.year, rnd.month, min(max(1, rnd.registration_open_until_day), last))


def state(db: Session, *, user: User | None) -> WaitlistStateOut:
    group = _group(db)
    today = _today()
    current = _round(db, group, today.year, today.month)
    ny, nm = _next(today.year, today.month)
    upcoming = _round(db, group, ny, nm)

    # Which round, if any, people can join right now.
    open_round: Round | None = None
    if upcoming is not None and upcoming.status == RoundStatus.registration_open:
        open_round = upcoming
    elif current is not None and current.status == RoundStatus.registration_open:
        open_round = current

    # The month people wait for: the open round's, or next month's.
    year, month = (open_round.year, open_round.month) if open_round is not None else (ny, nm)

    count = db.execute(
        select(func.count()).where(
            WaitlistEntry.group_id == group.id, WaitlistEntry.year == year, WaitlistEntry.month == month
        )
    ).scalar_one()

    mine: WaitlistEntry | None = None
    invited = 0
    people: list[WaitingPersonOut] = []
    if user is not None:
        mine = db.execute(
            select(WaitlistEntry).where(
                WaitlistEntry.group_id == group.id,
                WaitlistEntry.year == year,
                WaitlistEntry.month == month,
                WaitlistEntry.user_id == user.id,
            )
        ).scalar_one_or_none()
        invited = db.execute(
            select(func.count()).where(
                WaitlistEntry.group_id == group.id,
                WaitlistEntry.year == year,
                WaitlistEntry.month == month,
                WaitlistEntry.invited_by == user.id,
            )
        ).scalar_one()
        # Faces are for members only; a visitor sees the count.
        rows = db.execute(
            select(User.id, User.display_name, User.username, User.avatar_data)
            .join(WaitlistEntry, WaitlistEntry.user_id == User.id)
            .where(WaitlistEntry.group_id == group.id, WaitlistEntry.year == year, WaitlistEntry.month == month)
            .order_by(WaitlistEntry.created_at.desc())
            .limit(_SHOWN_PEOPLE)
        ).all()
        people = [
            WaitingPersonOut(user_id=str(uid), display_name=name or username, avatar_data=avatar)
            for uid, name, username, avatar in rows
        ]

    in_open = _in_round(db, open_round, user)
    joined = (
        db.execute(
            select(func.count()).where(
                RoundParticipant.round_id == open_round.id, RoundParticipant.status.in_(_IN_ROUND)
            )
        ).scalar_one()
        if open_round is not None
        else 0
    )
    last_day = calendar.monthrange(today.year, today.month)[1]
    return WaitlistStateOut(
        phase="registration" if open_round is not None else "waitlist",
        open_round=OpenRoundOut(
            id=str(open_round.id),
            year=open_round.year,
            month=open_round.month,
            registration_until=_registration_until(open_round).isoformat(),
            days_left=max(0, (_registration_until(open_round) - today).days),
        )
        if open_round is not None
        else None,
        year=year,
        month=month,
        starts_on=date(year, month, 1).isoformat(),
        count=int(count),
        joined=int(joined),
        in_current_round=_in_round(db, current, user),
        in_open_round=in_open,
        on_waitlist=mine is not None,
        waited_for_open=mine is not None and open_round is not None and not in_open,
        days_left_in_month=last_day - today.day,
        invited=int(invited),
        people=people,
        ref=user.username if user is not None else None,
    )


def _inviter(db: Session, ref: str | None, user: User) -> uuid.UUID | None:
    if not ref:
        return None
    found = db.execute(select(User.id).where(User.username == ref.strip().lstrip("@")[:60])).scalar_one_or_none()
    return found if found and found != user.id else None


def join(db: Session, *, user: User, ref: str | None = None) -> WaitlistStateOut:
    current = state(db, user=user)
    if current.phase == "registration":
        # Sign-up is open: the round itself, not a list, is the way in.
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="registration_open")
    if not current.on_waitlist:
        group = _group(db)
        db.add(
            WaitlistEntry(
                group_id=group.id,
                year=current.year,
                month=current.month,
                user_id=user.id,
                invited_by=_inviter(db, ref, user),
            )
        )
        db.commit()
    return state(db, user=user)


def leave(db: Session, *, user: User) -> WaitlistStateOut:
    current = state(db, user=user)
    group = _group(db)
    entry = db.execute(
        select(WaitlistEntry).where(
            WaitlistEntry.group_id == group.id,
            WaitlistEntry.year == current.year,
            WaitlistEntry.month == current.month,
            WaitlistEntry.user_id == user.id,
        )
    ).scalar_one_or_none()
    if entry is not None:
        db.delete(entry)
        db.commit()
    return state(db, user=user)
