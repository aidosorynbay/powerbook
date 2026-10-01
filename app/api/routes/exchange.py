from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.schemas.exchange import ExchangePairOut, ExchangePhotoIn, ExchangePhotoOut
from app.services.exchange import ExchangeService

router = APIRouter(prefix="/exchange", tags=["exchange"])


@router.get("/me", response_model=list[ExchangePairOut])
def my_obligations(db: Session = Depends(get_db), user=Depends(get_current_user)) -> list[ExchangePairOut]:
    pairs = ExchangeService(db).list_my(user_id=user.id)
    return [ExchangePairOut.model_validate(p) for p in pairs]


@router.post("/{pair_id}/mark_given", response_model=ExchangePairOut)
def mark_given(pair_id: uuid.UUID, db: Session = Depends(get_db), user=Depends(get_current_user)) -> ExchangePairOut:
    pair = ExchangeService(db).mark_given(pair_id=pair_id, user_id=user.id)
    return ExchangePairOut.model_validate(pair)


@router.post("/{pair_id}/mark_received", response_model=ExchangePairOut)
def mark_received(pair_id: uuid.UUID, db: Session = Depends(get_db), user=Depends(get_current_user)) -> ExchangePairOut:
    pair = ExchangeService(db).mark_received(pair_id=pair_id, user_id=user.id)
    return ExchangePairOut.model_validate(pair)



@router.post("/{pair_id}/photo", response_model=ExchangePhotoOut)
def add_photo(
    pair_id: uuid.UUID, payload: ExchangePhotoIn, db: Session = Depends(get_db), user=Depends(get_current_user)
) -> ExchangePhotoOut:
    """The book in hand: confirms the exchange and goes on the round's results page."""
    row = ExchangeService(db).add_photo(pair_id=pair_id, user_id=user.id, photo=payload.photo, caption=payload.caption)
    return ExchangePhotoOut(
        id=str(row.id),
        url=f"/exchange/photos/{row.id}?v={int(row.updated_at.timestamp()) if row.updated_at else 0}",
        role=row.role,
        caption=row.caption,
    )


@router.delete("/{pair_id}/photo", status_code=204)
def delete_photo(pair_id: uuid.UUID, db: Session = Depends(get_db), user=Depends(get_current_user)) -> None:
    ExchangeService(db).delete_photo(pair_id=pair_id, user_id=user.id)


@router.get("/photos/{photo_id}")
def photo(photo_id: uuid.UUID, db: Session = Depends(get_db)) -> Response:
    """Open like the market's photos: an <img> carries no token, and the id is not guessable."""
    data, media_type = ExchangeService(db).photo_file(photo_id=photo_id)
    return Response(content=data, media_type=media_type, headers={"Cache-Control": "public, max-age=604800"})
