from __future__ import annotations

import uuid
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.enums import RoundParticipantStatus
from app.models.round import ReadingLog, RoundParticipant
from app.models.user import User
from app.repositories.participants import RoundParticipantRepository
from app.repositories.reading_logs import ReadingLogRepository
from app.services.rounds import RoundService


class ReadingService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.participants = RoundParticipantRepository(db)
        self.logs = ReadingLogRepository(db)
        self.rounds = RoundService(db)



    def log_minutes(
        self,
        *,
        round_id: uuid.UUID,
        user_id: uuid.UUID,
        day: date,
        minutes: int,
    ) -> ReadingLog:
        participant = self.participants.get_for_user(round_id=round_id, user_id=user_id)
        if participant is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a participant")
        if participant.status in {RoundParticipantStatus.removed_by_admin}:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")

        return self.logs.upsert_minutes(round_id=round_id, user_id=user_id, day=day, minutes=minutes)

    def calendar_for_user(self, *, round_id: uuid.UUID, user_id: uuid.UUID) -> dict:
        rnd = self.rounds.rounds.get(round_id)
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
            days.append({"date": d.isoformat(), "minutes": minutes, "score": score})
            total_minutes += minutes
            total_score += score

        return {"round_id": str(round_id), "total_minutes": total_minutes, "total_score": total_score, "days": days}

    def leaderboard(self, *, round_id: uuid.UUID) -> list[dict]:
        # Get all active participants for the round with their user info
        participants_stmt = (
            select(RoundParticipant.user_id, User.display_name)
            .join(User, RoundParticipant.user_id == User.id)
            .where(
                RoundParticipant.round_id == round_id,
                RoundParticipant.status == RoundParticipantStatus.active,
            )
        )
        participants = {row.user_id: row.display_name for row in self.db.execute(participants_stmt).all()}

        # Get scores for participants
        scores_stmt = (
            select(
                ReadingLog.user_id.label("user_id"),
                func.coalesce(func.sum(ReadingLog.score), 0).label("total_score"),
                func.coalesce(func.sum(ReadingLog.score), 0).label("days_read"),
            )
            .where(ReadingLog.round_id == round_id)
            .group_by(ReadingLog.user_id)
        )
        scores = {row.user_id: (int(row.total_score), int(row.days_read)) for row in self.db.execute(scores_stmt).all()}

        # Build leaderboard: all participants, sorted by score
        leaderboard = []
        for user_id, display_name in participants.items():
            total_score, days_read = scores.get(user_id, (0, 0))
            leaderboard.append({
                "user_id": str(user_id),
                "display_name": display_name,
                "total_score": total_score,
                "days_read": days_read,
            })

        leaderboard.sort(key=lambda x: (-x["total_score"], x["display_name"]))
        return leaderboard

