from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user_optional, require_admin
from app.db.session import get_db
from app.models.user import User
from app.schemas.suggestions import SuggestionCreate, SuggestionOut
from app.services.suggestions import SuggestionService

router = APIRouter(prefix="/suggestions", tags=["suggestions"])


@router.post("", response_model=SuggestionOut)
def create_suggestion(
    payload: SuggestionCreate,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_current_user_optional),
) -> SuggestionOut:
    return SuggestionService(db).create(
        name=payload.name,
        message=payload.message,
        user_id=user.id if user else None,
    )


@router.get("", response_model=list[SuggestionOut])
def list_suggestions(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> list[SuggestionOut]:
    return SuggestionService(db).list_all()
