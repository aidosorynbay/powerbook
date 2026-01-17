from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.schemas.exchange import ExchangePairOut
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

