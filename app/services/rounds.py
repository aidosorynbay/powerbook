from __future__ import annotations

import calendar
import random
import uuid
from collections import defaultdict
from datetime import date, datetime
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.models.enums import Gender, ResultGroup, RoundParticipantStatus, RoundStatus
from app.models.round import BookExchangePair, Round, RoundParticipant, RoundResult
from app.repositories.exchange_pairs import BookExchangePairRepository
from app.repositories.participants import RoundParticipantRepository
from app.repositories.reading_logs import ReadingLogRepository
from app.repositories.results import RoundResultRepository
from app.repositories.rounds import RoundRepository
from app.repositories.users import UserRepository


class RoundService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.rounds = RoundRepository(db)
        self.participants = RoundParticipantRepository(db)
        self.reading_logs = ReadingLogRepository(db)
        self.users = UserRepository(db)
        self.pairs = BookExchangePairRepository(db)
        self.results = RoundResultRepository(db)

    def get_round(self, round_id: uuid.UUID) -> Round | None:
        return self.rounds.get(round_id)

    def get_last_completed(self, *, group_id: uuid.UUID) -> Round | None:
        return self.rounds.get_last_completed(group_id=group_id)

    def list_for_group(self, *, group_id: uuid.UUID, limit: int = 200) -> list[Round]:
        return self.rounds.list_for_group(group_id=group_id, limit=limit)

    def get_round_results(self, *, round_id: uuid.UUID) -> dict:
        rnd = self.rounds.get(round_id)
        if rnd is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Round not found")

        rows = self.results.list_for_round_with_user_names(round_id=round_id)
        results = [
            {
                "user_id": str(result.user_id),
                "display_name": display_name,
                "total_score": result.total_score,
                "rank": result.rank,
                "group": result.group.value,
            }
            for result, display_name in rows
        ]

        pair_rows = self.pairs.list_for_round_with_user_names(round_id=round_id)
        pairs = [
            {"giver_name": giver_name, "receiver_name": receiver_name}
            for _pair, giver_name, receiver_name in pair_rows
        ]

        return {
            "round_id": str(round_id),
            "year": rnd.year,
            "month": rnd.month,
            "results": results,
            "pairs": pairs,
        }

    def create_round(
        self,
        *,
        group_id: uuid.UUID,
        year: int,
        month: int,
        timezone: str = "UTC",
        registration_open_until_day: int = 10,
    ) -> Round:
        existing = self.rounds.get_by_group_year_month(group_id=group_id, year=year, month=month)
        if existing is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Round already exists for this month")
        return self.rounds.create(
            group_id=group_id,
            year=year,
            month=month,
            timezone=timezone,
            registration_open_until_day=registration_open_until_day,
        )

    def set_status(self, *, round_id: uuid.UUID, status_: RoundStatus, now: datetime | None = None) -> Round:
        rnd = self.rounds.get(round_id)
        if rnd is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Round not found")

        rnd.status = status_
        if status_ == RoundStatus.registration_open:
            rnd.started_at = rnd.started_at or (now or datetime.now(tz=ZoneInfo(rnd.timezone)))
        if status_ in {RoundStatus.closed, RoundStatus.results_published}:
            rnd.closed_at = rnd.closed_at or (now or datetime.now(tz=ZoneInfo(rnd.timezone)))

        self.db.commit()
        self.db.refresh(rnd)
        return rnd

    def _today_in_round_tz(self, rnd: Round) -> date:
        return datetime.now(tz=ZoneInfo(rnd.timezone)).date()

    def _is_before_deadline(self, rnd: Round, today: date | None = None) -> bool:
        d = today or self._today_in_round_tz(rnd)
        return d.day <= rnd.registration_open_until_day

    def join(self, *, round_id: uuid.UUID, user_id: uuid.UUID) -> RoundParticipant:
        rnd = self.rounds.get(round_id)
        if rnd is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Round not found")
        if rnd.status != RoundStatus.registration_open:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Registration is not open")

        existing = self.participants.get_for_user(round_id=round_id, user_id=user_id)
        if existing is None:
            return self.participants.create(round_id=round_id, user_id=user_id)

        if existing.status in {RoundParticipantStatus.left_before_deadline, RoundParticipantStatus.removed_by_admin}:
            existing.status = RoundParticipantStatus.active
            self.db.commit()
            self.db.refresh(existing)
            return existing

        return existing

    def leave(self, *, round_id: uuid.UUID, user_id: uuid.UUID) -> RoundParticipant:
        """
        Leave a round. Only allowed before the registration deadline (10th of month).
        After the deadline, users must complete the round.
        """
        rnd = self.rounds.get(round_id)
        if rnd is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Round not found")

        participant = self.participants.get_for_user(round_id=round_id, user_id=user_id)
        if participant is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not a participant")

        if participant.status != RoundParticipantStatus.active:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Already left this round")

        if not self._is_before_deadline(rnd):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Cannot leave after day {rnd.registration_open_until_day}",
            )

        participant.status = RoundParticipantStatus.left_before_deadline
        self.db.commit()
        self.db.refresh(participant)
        return participant

    def compute_and_publish_results(self, *, round_id: uuid.UUID) -> dict:
        rnd = self.rounds.get(round_id)
        if rnd is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Round not found")

        # collect participants
        participants = self.participants.list_for_round(round_id=round_id)
        if not participants:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="No participants")

        # aggregate scores per user via repository
        scores = self.reading_logs.aggregate_scores_by_user(round_id=round_id)

        # load users for gender matching
        user_ids = [p.user_id for p in participants]
        users = self.users.get_by_ids(user_ids)

        ranking = sorted(
            [(uid, scores.get(uid, 0)) for uid in user_ids],
            key=lambda x: (x[1], str(x[0])),
            reverse=True,
        )

        # wipe old computed artifacts (idempotency for MVP)
        self.db.execute(delete(RoundResult).where(RoundResult.round_id == round_id))
        self.db.execute(delete(BookExchangePair).where(BookExchangePair.round_id == round_id))

        # create results
        n = len(ranking)
        winners_n = n // 2  # 50% winners; odd -> more losers
        winners_set = {uid for uid, _ in ranking[:winners_n]}

        results: list[RoundResult] = []
        for idx, (uid, total) in enumerate(ranking, start=1):
            grp = ResultGroup.winner if uid in winners_set else ResultGroup.loser
            results.append(RoundResult(round_id=round_id, user_id=uid, total_score=total, rank=idx, group=grp))
        self.db.add_all(results)

        # book exchange pairs: losers give -> winners receive
        winners = [uid for uid, _ in ranking if uid in winners_set]
        losers = [uid for uid, _ in ranking if uid not in winners_set]

        pairs_created: list[BookExchangePair] = []
        if winners and losers:
            pairs_created = self._pair_losers_to_winners(users=users, round_id=round_id, losers=losers, winners=winners)
            self.db.add_all(pairs_created)

        rnd.status = RoundStatus.results_published
        rnd.closed_at = rnd.closed_at or datetime.now(tz=ZoneInfo(rnd.timezone))
        self.db.commit()

        return {
            "round_id": str(round_id),
            "participants": n,
            "winners": len(winners),
            "losers": len(losers),
            "pairs": len(pairs_created),
        }

    def _pair_losers_to_winners(
        self,
        *,
        users: dict[uuid.UUID, object | None],
        round_id: uuid.UUID,
        losers: list[uuid.UUID],
        winners: list[uuid.UUID],
    ) -> list[BookExchangePair]:
        # gender-aware pairing if possible, otherwise fallback.
        losers_by_gender: dict[Gender | None, list[uuid.UUID]] = defaultdict(list)
        winners_by_gender: dict[Gender | None, list[uuid.UUID]] = defaultdict(list)

        def _gender(uid: uuid.UUID) -> Gender | None:
            u = users.get(uid)
            return getattr(u, "gender", None)

        for uid in losers:
            losers_by_gender[_gender(uid)].append(uid)
        for uid in winners:
            winners_by_gender[_gender(uid)].append(uid)

        all_winners = winners[:]
        random.shuffle(all_winners)

        pairs: list[BookExchangePair] = []

        def _take_winner(preferred_gender: Gender | None) -> uuid.UUID | None:
            bucket = winners_by_gender.get(preferred_gender) or []
            if bucket:
                return bucket.pop()
            # fallback to any available winner regardless of gender
            for g, b in winners_by_gender.items():
                if b:
                    return b.pop()
            return None

        for loser_id in losers:
            w = _take_winner(_gender(loser_id))
            if w is None:
                break
            if w == loser_id:
                continue
            pairs.append(BookExchangePair(round_id=round_id, giver_user_id=loser_id, receiver_user_id=w))

        return pairs

    def month_calendar(self, *, year: int, month: int) -> list[date]:
        days_in_month = calendar.monthrange(year, month)[1]
        return [date(year, month, d) for d in range(1, days_in_month + 1)]

