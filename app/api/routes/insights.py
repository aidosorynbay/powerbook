from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.schemas.insights import (
    BadgeStatsOut,
    AllTimeProfileOut,
    ArchetypeOut,
    BadgeOut,
    BookshelfEntryOut,
    CelebrityMatchOut,
    HallOfFameOut,
    LeagueTierOut,
    ManualBookIn,
    ManualBookOut,
    PercentileOut,
    PopularBookOut,
    ReadingTwinOut,
    WrappedOut,
)
from app.services.insights import InsightsService

router = APIRouter(prefix="/insights", tags=["insights"])


@router.get("/profile", response_model=AllTimeProfileOut)
def get_all_time_profile(db: Session = Depends(get_db), user=Depends(get_current_user)) -> AllTimeProfileOut:
    return InsightsService(db).all_time_profile(user_id=user.id)


@router.get("/percentile", response_model=PercentileOut)
def get_percentile(
    round_id: uuid.UUID | None = Query(default=None),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> PercentileOut:
    return InsightsService(db).percentile(user_id=user.id, round_id=round_id)


@router.get("/archetype", response_model=ArchetypeOut)
def get_archetype(db: Session = Depends(get_db), user=Depends(get_current_user)) -> ArchetypeOut:
    return InsightsService(db).archetype(user_id=user.id)


@router.get("/bookshelf", response_model=list[BookshelfEntryOut])
def get_bookshelf(db: Session = Depends(get_db), user=Depends(get_current_user)) -> list[BookshelfEntryOut]:
    return InsightsService(db).bookshelf(user_id=user.id)


@router.get("/books", response_model=list[ManualBookOut])
def list_manual_books(db: Session = Depends(get_db), user=Depends(get_current_user)) -> list[ManualBookOut]:
    return InsightsService(db).manual_books(user_id=user.id)


@router.post("/books", response_model=ManualBookOut, status_code=status.HTTP_201_CREATED)
def add_manual_book(
    payload: ManualBookIn,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> ManualBookOut:
    try:
        return InsightsService(db).add_manual_book(user_id=user.id, payload=payload)
    except ValueError as exc:
        # The reason travels as a code so the client can translate it.
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.delete("/books/{book_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_manual_book(
    book_id: uuid.UUID,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> None:
    if not InsightsService(db).delete_manual_book(user_id=user.id, book_id=book_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not_found")


@router.get("/popular-books", response_model=list[PopularBookOut])
def get_popular_books(
    limit: int = Query(default=10, ge=1, le=50),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> list[PopularBookOut]:
    return InsightsService(db).popular_books(limit=limit)


@router.get("/twins", response_model=list[ReadingTwinOut])
def get_reading_twins(
    limit: int = Query(default=5, ge=1, le=20),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> list[ReadingTwinOut]:
    return InsightsService(db).reading_twins(user_id=user.id, limit=limit)


@router.get("/celebrity-match", response_model=list[CelebrityMatchOut])
def get_celebrity_match(db: Session = Depends(get_db), user=Depends(get_current_user)) -> list[CelebrityMatchOut]:
    return InsightsService(db).celebrity_match(user_id=user.id)


@router.get("/badges", response_model=list[BadgeOut])
def get_badges(db: Session = Depends(get_db), user=Depends(get_current_user)) -> list[BadgeOut]:
    return InsightsService(db).badges(user_id=user.id)


@router.get("/league", response_model=LeagueTierOut)
def get_league(
    round_id: uuid.UUID | None = Query(default=None),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> LeagueTierOut:
    return InsightsService(db).league(user_id=user.id, round_id=round_id)


@router.get("/wrapped", response_model=WrappedOut)
def get_wrapped(
    year: int | None = Query(default=None),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> WrappedOut:
    return InsightsService(db).wrapped(user_id=user.id, year=year)


@router.get("/hall-of-fame", response_model=HallOfFameOut)
def get_hall_of_fame(db: Session = Depends(get_db)) -> HallOfFameOut:
    """Public leaderboard of all-time top readers — no login required."""
    return InsightsService(db).hall_of_fame()


@router.get("/badges/{key}/stats", response_model=BadgeStatsOut)
def badge_stats(
    key: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> BadgeStatsOut:
    """How rare this badge is and who else holds it."""
    return InsightsService(db).badge_stats(key=key, viewer_id=user.id)
