from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.reading_ai import (
    DigestIn,
    DigestOut,
    DismissIn,
    NotebookEntryOut,
    PicksIn,
    PicksOut,
    ReadingOverviewOut,
    ReplaceIn,
    RecommendationOut,
)
from app.schemas.round_review import RoundReviewOut
from app.services import librarian, reading_ai, round_review

router = APIRouter(prefix="/reading", tags=["reading"])


@router.get("/overview", response_model=ReadingOverviewOut)
def overview(
    period: str = Query(default="all", max_length=7),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ReadingOverviewOut:
    return reading_ai.overview(db, user=user, period=period)


@router.get("/recommendations", response_model=list[RecommendationOut])
def recommendations(
    limit: int = Query(default=12, ge=1, le=30),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[RecommendationOut]:
    return reading_ai.recommendations(db, user=user, limit=limit)


@router.get("/picks", response_model=PicksOut)
def get_picks(
    lang: str = Query(default="ru", pattern="^(ru|kk|en)$"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PicksOut:
    """The AI librarian's picks for the reader: what to read next, and why."""
    return librarian.get(db, user=user, lang=lang)


@router.post("/picks", response_model=PicksOut, status_code=status.HTTP_202_ACCEPTED)
def start_picks(payload: PicksIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> PicksOut:
    if payload.lang not in ("ru", "kk", "en"):
        payload.lang = "ru"
    return librarian.start(
        db, user=user, lang=payload.lang, force=payload.force, wish=payload.wish, keep_wish=payload.keep_wish
    )


@router.post("/picks/replace", response_model=PicksOut)
def replace_pick(payload: ReplaceIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> PicksOut:
    """«Не моё»: never suggested again, and another book takes its place."""
    return librarian.replace(
        db, user=user, lang=payload.lang if payload.lang in ("ru", "kk", "en") else "ru",
        work_key=payload.work_key or None, title=payload.title or None, author=payload.author or None,
    )


@router.post("/picks/dismiss", status_code=status.HTTP_204_NO_CONTENT)
def dismiss_pick(payload: DismissIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> None:
    """«Не моё»: never suggested again."""
    librarian.dismiss(
        db, user=user, work_key=(payload.work_key or "")[:300] or None, title=(payload.title or "")[:300] or None,
        author=(payload.author or "")[:200] or None,
    )


@router.delete("/picks/dismiss", status_code=status.HTTP_204_NO_CONTENT)
def undismiss_pick(
    work_key: str | None = Query(default=None, max_length=300),
    title: str | None = Query(default=None, max_length=300),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    librarian.undismiss(db, user=user, work_key=work_key, title=title)


@router.get("/notebook", response_model=list[NotebookEntryOut])
def notebook(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[NotebookEntryOut]:
    return reading_ai.notebook(db, user=user)


@router.get("/round-review", response_model=RoundReviewOut)
def get_round_review(
    round_id: uuid.UUID | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RoundReviewOut:
    """The reader's round looked back on: numbers beside their own past
    rounds, what went well, where the days went, and habits for that."""
    return round_review.review(db, user=user, round_id=round_id)


@router.get("/digest", response_model=DigestOut | None)
def get_digest(
    kind: str = Query(pattern="^(period|book|round)$"),
    scope: str = Query(max_length=80),
    lang: str = Query(default="ru", pattern="^(ru|kk|en)$"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DigestOut | None:
    return reading_ai.get_digest(db, user=user, kind=kind, scope=scope, lang=lang)


@router.post("/digest", response_model=DigestOut, status_code=status.HTTP_202_ACCEPTED)
def start_digest(
    payload: DigestIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DigestOut:
    return reading_ai.start_digest(
        db, user=user, kind=payload.kind, scope=payload.scope[:80], lang=payload.lang, force=payload.force
    )
