from __future__ import annotations

import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.round import BookExchangePair
from app.repositories.exchange_pairs import BookExchangePairRepository
from app.repositories.rounds import RoundRepository


class ExchangeService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.pairs = BookExchangePairRepository(db)
        self.rounds = RoundRepository(db)

    def list_my(self, *, user_id: uuid.UUID) -> list[BookExchangePair]:
        return self.pairs.list_for_user(user_id=user_id)

    def mark_given(self, *, pair_id: uuid.UUID, user_id: uuid.UUID) -> BookExchangePair:
        pair = self.pairs.get(pair_id)
        if pair is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pair not found")
        if pair.giver_user_id != user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")

        rnd = self.rounds.get(pair.round_id)
        tz = ZoneInfo(rnd.timezone) if rnd else ZoneInfo("UTC")
        return self.pairs.mark_given(pair=pair, at=datetime.now(tz=tz))

    def mark_received(self, *, pair_id: uuid.UUID, user_id: uuid.UUID) -> BookExchangePair:
        pair = self.pairs.get(pair_id)
        if pair is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pair not found")
        if pair.receiver_user_id != user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")

        rnd = self.rounds.get(pair.round_id)
        tz = ZoneInfo(rnd.timezone) if rnd else ZoneInfo("UTC")
        return self.pairs.mark_received(pair=pair, at=datetime.now(tz=tz))

