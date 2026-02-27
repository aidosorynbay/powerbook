from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models.round import BookExchangePair
from app.models.user import User
from app.repositories.base import BaseRepository


class BookExchangePairRepository(BaseRepository[BookExchangePair]):
    def __init__(self, db: Session) -> None:
        super().__init__(db)

    def get(self, pair_id: uuid.UUID) -> BookExchangePair | None:
        return self.db.get(BookExchangePair, pair_id)

    def list_for_round(self, *, round_id: uuid.UUID) -> list[BookExchangePair]:
        stmt = select(BookExchangePair).where(BookExchangePair.round_id == round_id)
        return list(self.db.execute(stmt).scalars().all())

    def list_for_user(self, *, user_id: uuid.UUID) -> list[BookExchangePair]:
        stmt = select(BookExchangePair).where(
            or_(
                BookExchangePair.giver_user_id == user_id,
                BookExchangePair.receiver_user_id == user_id,
            )
        )
        return list(self.db.execute(stmt).scalars().all())

    def list_for_round_with_user_names(self, *, round_id: uuid.UUID) -> list[tuple[BookExchangePair, str, str]]:
        giver = User.__table__.alias("giver")
        receiver = User.__table__.alias("receiver")
        stmt = (
            select(
                BookExchangePair,
                giver.c.display_name.label("giver_name"),
                receiver.c.display_name.label("receiver_name"),
            )
            .join(giver, BookExchangePair.giver_user_id == giver.c.id)
            .join(receiver, BookExchangePair.receiver_user_id == receiver.c.id)
            .where(BookExchangePair.round_id == round_id)
        )
        return list(self.db.execute(stmt).all())

    def create(self, *, round_id: uuid.UUID, giver_user_id: uuid.UUID, receiver_user_id: uuid.UUID) -> BookExchangePair:
        pair = BookExchangePair(round_id=round_id, giver_user_id=giver_user_id, receiver_user_id=receiver_user_id)
        self.db.add(pair)
        self.db.commit()
        self.db.refresh(pair)
        return pair

    def mark_given(self, *, pair: BookExchangePair, at: datetime) -> BookExchangePair:
        pair.giver_marked_given_at = at
        self.db.commit()
        self.db.refresh(pair)
        return pair

    def mark_received(self, *, pair: BookExchangePair, at: datetime) -> BookExchangePair:
        pair.receiver_marked_received_at = at
        self.db.commit()
        self.db.refresh(pair)
        return pair

