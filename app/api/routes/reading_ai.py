from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.reading_ai import DigestIn, DigestOut, NotebookEntryOut, ReadingOverviewOut, RecommendationOut
from app.services import reading_ai

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


@router.get("/notebook", response_model=list[NotebookEntryOut])
def notebook(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[NotebookEntryOut]:
    return reading_ai.notebook(db, user=user)


@router.get("/digest", response_model=DigestOut | None)
def get_digest(
    kind: str = Query(pattern="^(period|book)$"),
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
