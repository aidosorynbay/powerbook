from __future__ import annotations

import calendar
import uuid
from datetime import date, datetime
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.enums import RoundParticipantStatus, RoundStatus
from app.models.round import ReadingLog
from app.repositories.reading_logs import ReadingLogRepository
from app.services.rounds import RoundService

CORRECTION_DEADLINE_HOUR = 20  # 8 PM
CORRECTION_TZ = ZoneInfo("Asia/Almaty")  # GMT+5


class ReadingService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.logs = ReadingLogRepository(db)
        self.rounds = RoundService(db)

    def log_minutes(
        self,
        *,
        round_id: uuid.UUID,
        user_id: uuid.UUID,
        day: date,
        minutes: int,
        book_finished: bool = False,
        comment: str | None = None,
    ) -> ReadingLog:
        rnd = self.rounds.get_round(round_id)
        if rnd is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Round not found")
        if rnd.status in {RoundStatus.closed, RoundStatus.results_published}:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Round is closed")

        last_day_num = calendar.monthrange(rnd.year, rnd.month)[1]
        last_day_date = date(rnd.year, rnd.month, last_day_num)
        now_local = datetime.now(tz=CORRECTION_TZ)
        today_local = now_local.date()
        is_last_day_today = today_local == last_day_date

        # On the last day, enforce 8 PM GMT+5 correction deadline
        if is_last_day_today and now_local.hour >= CORRECTION_DEADLINE_HOUR:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Correction period has ended",
            )

        # Before last day, don't allow logging the last day date
        if not is_last_day_today and day == last_day_date:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Last day is non-competitive",
            )

        participant = self.rounds.participants.get_for_user(round_id=round_id, user_id=user_id)
        if participant is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a participant")
        if participant.status in {RoundParticipantStatus.removed_by_admin}:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")

        # Last day date itself: allow logging but score=0
        force_score = 0 if day == last_day_date else None
        return self.logs.upsert_minutes(
            round_id=round_id, user_id=user_id, day=day, minutes=minutes,
            force_score=force_score, book_finished=book_finished, comment=comment,
        )

    def calendar_for_user(self, *, round_id: uuid.UUID, user_id: uuid.UUID) -> dict:
        rnd = self.rounds.get_round(round_id)
        if rnd is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Round not found")

        month_days = self.rounds.month_calendar(year=rnd.year, month=rnd.month)
        logs = self.logs.list_for_user(round_id=round_id, user_id=user_id)
        by_date = {l.date: l for l in logs}

        days = []
        total_minutes = 0
        total_score = 0
        for d in month_days:
            row = by_date.get(d)
            minutes = int(row.minutes) if row else 0
            score = int(row.score) if row else 0
            book_finished = bool(row.book_finished) if row else False
            comment = row.comment if row else None
            days.append({
                "date": d.isoformat(), "minutes": minutes, "score": score,
                "book_finished": book_finished, "comment": comment,
            })
            total_minutes += minutes
            total_score += score

        return {"round_id": str(round_id), "total_minutes": total_minutes, "total_score": total_score, "days": days}

    def yearly_archive(self, *, user_id: uuid.UUID, year: int, group_id: uuid.UUID) -> dict:
        all_rounds = self.rounds.list_for_group(group_id=group_id, limit=200)
        year_rounds = [r for r in all_rounds if r.year == year]

        round_ids = [r.id for r in year_rounds]
        logs = self.logs.list_for_user_rounds(round_ids=round_ids, user_id=user_id)
        logs_by_date: dict[date, int] = {}
        for log in logs:
            logs_by_date[log.date] = int(log.minutes)

        # Determine which months the user participated in
        participated_months: list[int] = []
        for rnd in year_rounds:
            participant = self.rounds.participants.get_for_user(round_id=rnd.id, user_id=user_id)
            if participant is not None:
                participated_months.append(rnd.month)

        months: dict[int, list[dict]] = {}
        for month in range(1, 13):
            days_in_month = calendar.monthrange(year, month)[1]
            days = []
            for d in range(1, days_in_month + 1):
                dt = date(year, month, d)
                minutes = logs_by_date.get(dt, 0)
                days.append({"date": dt.isoformat(), "minutes": minutes})
            months[month] = days

        return {"year": year, "months": months, "participated_months": participated_months}

    def leaderboard(self, *, round_id: uuid.UUID) -> list[dict]:
        data = self.logs.leaderboard_data(round_id=round_id)
        data.sort(key=lambda x: (-x["total_score"], x["display_name"]))
        return data

