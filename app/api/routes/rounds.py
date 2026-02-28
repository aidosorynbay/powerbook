from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin
from app.db.session import get_db
from app.models.enums import RoundStatus
from app.schemas.reading import LogMinutesRequest
from app.schemas.rounds import ParticipantOut, RoundCreateRequest, RoundOut
from app.services.groups import GroupService
from app.services.reading import ReadingService
from app.services.rounds import RoundService

router = APIRouter(prefix="/rounds", tags=["rounds"])

DEFAULT_GROUP_SLUG = "powerbook"


@router.get("/archive/{year}")
def yearly_archive(year: int, db: Session = Depends(get_db), user=Depends(get_current_user)) -> dict:
    group = GroupService(db).get_by_slug(slug=DEFAULT_GROUP_SLUG)
    return ReadingService(db).yearly_archive(user_id=user.id, year=year, group_id=group.id)


@router.get("/last-completed")
def last_completed_round(db: Session = Depends(get_db), _user=Depends(get_current_user)) -> dict | None:
    group = GroupService(db).get_by_slug(slug=DEFAULT_GROUP_SLUG)
    rnd = RoundService(db).get_last_completed(group_id=group.id)
    if rnd is None:
        return None
    return {"id": str(rnd.id), "year": rnd.year, "month": rnd.month}


@router.get("/{round_id}/results")
def round_results(round_id: uuid.UUID, db: Session = Depends(get_db), user=Depends(get_current_user)) -> dict:
    return RoundService(db).get_round_results(round_id=round_id, user_id=user.id)


@router.post("", response_model=RoundOut)
def create_round(
    payload: RoundCreateRequest,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
) -> RoundOut:
    rnd = RoundService(db).create_round(
        group_id=payload.group_id,
        year=payload.year,
        month=payload.month,
        timezone=payload.timezone,
        registration_open_until_day=payload.registration_open_until_day,
    )
    return RoundOut.model_validate(rnd)


@router.post("/{round_id}/open_registration", response_model=RoundOut)
def open_registration(
    round_id: uuid.UUID,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
) -> RoundOut:
    rnd = RoundService(db).set_status(round_id=round_id, status_=RoundStatus.registration_open)
    return RoundOut.model_validate(rnd)


@router.post("/{round_id}/lock", response_model=RoundOut)
def lock_round(
    round_id: uuid.UUID,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
) -> RoundOut:
    rnd = RoundService(db).set_status(round_id=round_id, status_=RoundStatus.locked)
    return RoundOut.model_validate(rnd)


@router.post("/{round_id}/close", response_model=RoundOut)
def close_round(
    round_id: uuid.UUID,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
) -> RoundOut:
    rnd = RoundService(db).set_status(round_id=round_id, status_=RoundStatus.closed)
    return RoundOut.model_validate(rnd)


@router.post("/{round_id}/publish_results")
def publish_results(
    round_id: uuid.UUID,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
) -> dict:
    return RoundService(db).compute_and_publish_results(round_id=round_id)


@router.post("/{round_id}/join", response_model=ParticipantOut)
def join_round(round_id: uuid.UUID, db: Session = Depends(get_db), user=Depends(get_current_user)) -> ParticipantOut:
    p = RoundService(db).join(round_id=round_id, user_id=user.id)
    return ParticipantOut.model_validate(p)


@router.post("/{round_id}/leave", response_model=ParticipantOut)
def leave_round(round_id: uuid.UUID, db: Session = Depends(get_db), user=Depends(get_current_user)) -> ParticipantOut:
    p = RoundService(db).leave(round_id=round_id, user_id=user.id)
    return ParticipantOut.model_validate(p)


@router.post("/{round_id}/reading_logs")
def log_minutes(
    round_id: uuid.UUID,
    payload: LogMinutesRequest,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> dict:
    row = ReadingService(db).log_minutes(
        round_id=round_id, user_id=user.id, day=payload.date, minutes=payload.minutes,
        book_finished=payload.book_finished, comment=payload.comment,
    )
    return {
        "id": str(row.id), "date": row.date.isoformat(), "minutes": int(row.minutes),
        "score": int(row.score), "book_finished": bool(row.book_finished), "comment": row.comment,
    }


@router.get("/{round_id}/calendar")
def my_calendar(round_id: uuid.UUID, db: Session = Depends(get_db), user=Depends(get_current_user)) -> dict:
    return ReadingService(db).calendar_for_user(round_id=round_id, user_id=user.id)


@router.get("/{round_id}/calendar/{user_id}")
def user_calendar(
    round_id: uuid.UUID, user_id: uuid.UUID, db: Session = Depends(get_db), _user=Depends(get_current_user)
) -> dict:
    return ReadingService(db).calendar_for_user(round_id=round_id, user_id=user_id)


@router.get("/{round_id}/leaderboard")
def leaderboard(round_id: uuid.UUID, db: Session = Depends(get_db), _user=Depends(get_current_user)) -> list[dict]:
    # “near-real-time” MVP: clients poll this endpoint (e.g., every 5–10 seconds)
    return ReadingService(db).leaderboard(round_id=round_id)

