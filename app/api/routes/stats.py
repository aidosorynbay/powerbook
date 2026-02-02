from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.stats import PublicStatsOut
from app.services.stats import StatsService

router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("/public", response_model=PublicStatsOut)
def get_public_stats(db: Session = Depends(get_db)) -> PublicStatsOut:
    """
    Get public statistics for display on homepage.
    No authentication required.
    """
    return StatsService(db).get_public_stats()
