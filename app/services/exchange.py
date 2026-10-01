from __future__ import annotations

import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.photos import check_photo, decode_photo
from app.models.exchange_photo import ExchangePhoto
from app.models.round import BookExchangePair
from app.models.user import User
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

    # ---------- photos of the exchange, for the results page ----------

    def _pair_for(self, *, pair_id: uuid.UUID, user_id: uuid.UUID) -> tuple[BookExchangePair, str]:
        pair = self.pairs.get(pair_id)
        if pair is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pair not found")
        if user_id == pair.giver_user_id:
            return pair, "giver"
        if user_id == pair.receiver_user_id:
            return pair, "receiver"
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")

    def add_photo(self, *, pair_id: uuid.UUID, user_id: uuid.UUID, photo: str, caption: str | None) -> ExchangePhoto:
        """The book in the reader's hands. One per reader per pair (a new one
        replaces it), and sending it confirms the exchange as the checkbox does."""
        pair, role = self._pair_for(pair_id=pair_id, user_id=user_id)
        data = check_photo(photo)
        if not data:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="bad_photo")
        row = self.db.execute(
            select(ExchangePhoto).where(ExchangePhoto.pair_id == pair.id, ExchangePhoto.user_id == user_id)
        ).scalar_one_or_none()
        if row is None:
            row = ExchangePhoto(pair_id=pair.id, user_id=user_id, role=role, photo=data)
            self.db.add(row)
        row.photo = data
        row.caption = (caption or "").strip()[:200] or None
        row.hidden = False
        if role == "giver" and pair.giver_marked_given_at is None:
            self.mark_given(pair_id=pair.id, user_id=user_id)
        elif role == "receiver" and pair.receiver_marked_received_at is None:
            self.mark_received(pair_id=pair.id, user_id=user_id)
        self.db.commit()
        self.db.refresh(row)
        return row

    def delete_photo(self, *, pair_id: uuid.UUID, user_id: uuid.UUID) -> None:
        pair, _role = self._pair_for(pair_id=pair_id, user_id=user_id)
        row = self.db.execute(
            select(ExchangePhoto).where(ExchangePhoto.pair_id == pair.id, ExchangePhoto.user_id == user_id)
        ).scalar_one_or_none()
        if row is not None:
            self.db.delete(row)
            self.db.commit()

    def photo_file(self, *, photo_id: uuid.UUID) -> tuple[bytes, str]:
        row = self.db.get(ExchangePhoto, photo_id)
        decoded = decode_photo(row.photo) if row is not None and not row.hidden else None
        if decoded is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="photo_not_found")
        return decoded

    def photos_for_round(self, *, round_id: uuid.UUID) -> list[dict]:
        """The round's exchange in pictures, newest first: who gave to whom, and the caption."""
        giver = User.__table__.alias("giver")
        receiver = User.__table__.alias("receiver")
        rows = self.db.execute(
            select(
                ExchangePhoto.id, ExchangePhoto.pair_id, ExchangePhoto.user_id, ExchangePhoto.role,
                ExchangePhoto.caption, ExchangePhoto.updated_at,
                giver.c.display_name, giver.c.telegram_id, receiver.c.display_name, receiver.c.telegram_id,
            )
            .join(BookExchangePair, BookExchangePair.id == ExchangePhoto.pair_id)
            .join(giver, BookExchangePair.giver_user_id == giver.c.id)
            .join(receiver, BookExchangePair.receiver_user_id == receiver.c.id)
            .where(BookExchangePair.round_id == round_id, ExchangePhoto.hidden.is_(False))
            .order_by(ExchangePhoto.updated_at.desc())
        ).all()
        return [
            {
                "id": str(pid),
                "pair_id": str(pair_id),
                "user_id": str(uid),
                "role": role,
                "caption": caption,
                # the version in the address lets a replaced photo show at once
                "url": f"/exchange/photos/{pid}?v={int(updated.timestamp()) if updated else 0}",
                "giver_name": giver_name,
                "giver_telegram_id": giver_tid,
                "receiver_name": receiver_name,
                "receiver_telegram_id": receiver_tid,
            }
            for pid, pair_id, uid, role, caption, updated, giver_name, giver_tid, receiver_name, receiver_tid in rows
        ]
