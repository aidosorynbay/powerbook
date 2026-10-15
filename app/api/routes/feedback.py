from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.feedback import FeedbackIn, FeedbackOut
from app.services import admin_ping
from app.services.feedback import FeedbackService

router = APIRouter(prefix="/feedback", tags=["feedback"])


@router.get("/due")
def feedback_due(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    """Whether to ask this reader now: not within two months of an answer, nor within a month of the last
    time the window came up, on any of their devices."""
    return {"due": FeedbackService(db).due(user=user)}


@router.post("/asked", status_code=204)
def feedback_asked(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> None:
    """The window has come up for this reader."""
    FeedbackService(db).asked(user=user)


@router.post("", response_model=FeedbackOut)
def send_feedback(
    payload: FeedbackIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> FeedbackOut:
    """What a reader thinks of PowerBook: into /admin, and to the founder in Telegram."""
    row = FeedbackService(db).create(user=user, **payload.model_dump())
    admin_ping.feedback_received(row=row, user=user)
    return FeedbackOut(id=row.id)
