from __future__ import annotations

import calendar
import uuid
from collections import defaultdict
from datetime import date, datetime
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.enums import RoundParticipantStatus, RoundStatus
from app.models.round import ReadingLog
from app.repositories.claims import ClaimsRepository
from app.repositories.reading_logs import ReadingLogRepository
from app.services.rounds import RoundService

CORRECTION_DEADLINE_HOUR = 20  # 8 PM
CORRECTION_TZ = ZoneInfo("Asia/Almaty")  # GMT+5


class ReadingService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.logs = ReadingLogRepository(db)
        self.rounds = RoundService(db)
        self.claims = ClaimsRepository(db)

    def log_minutes(
        self,
        *,
        round_id: uuid.UUID,
        user_id: uuid.UUID,
        day: date,
        minutes: int,
        book_finished: bool = False,
        comment: str | None = None,
        comment_private: bool = False,
    ) -> ReadingLog:
        rnd = self.rounds.get_round(round_id)
        if rnd is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Round not found")
        if rnd.status in {RoundStatus.closed, RoundStatus.results_published}:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Round is closed")

        # Round's own window — the whole month for a normal round, a narrower
        # slice for a mini-round. Days outside it can't be logged at all.
        if not rnd.covers(day):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Day is outside this round",
            )

        last_day_date = rnd.last_day_date
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
            comment_private=comment_private,
        )

    def calendar_for_user(self, *, round_id: uuid.UUID, user_id: uuid.UUID, viewer_id: uuid.UUID | None = None) -> dict:
        rnd = self.rounds.get_round(round_id)
        if rnd is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Round not found")

        is_owner = viewer_id is None or viewer_id == user_id

        month_days = self.rounds.month_calendar(year=rnd.year, month=rnd.month)
        logs = self.logs.list_for_user(round_id=round_id, user_id=user_id)
        by_date = {l.date: l for l in logs}

        days = []
        total_minutes = 0
        total_score = 0
        for d in month_days:
            # Keep the full month in the grid so the calendar keeps its shape,
            # but flag days outside this round's window — for a mini-round the
            # client draws those as decorative cells, not as missed days, and
            # they contribute nothing to the totals.
            in_round = rnd.covers(d)
            row = by_date.get(d)
            minutes = int(row.minutes) if row else 0
            score = int(row.score) if row else 0
            book_finished = bool(row.book_finished) if row else False
            is_private = bool(row.is_comment_private) if row else False
            comment = row.comment if row else None
            if is_private and not is_owner:
                comment = None
            days.append({
                "date": d.isoformat(), "minutes": minutes, "score": score,
                "book_finished": book_finished, "comment": comment,
                "comment_private": is_private,
                "in_round": in_round,
            })
            if in_round:
                total_minutes += minutes
                total_score += score

        return {
            "round_id": str(round_id),
            "total_minutes": total_minutes,
            "total_score": total_score,
            "start_day": max(1, rnd.start_day),
            "end_day": rnd.last_day_num,
            "is_partial_month": rnd.is_partial_month,
            "days": days,
        }

    def yearly_archive(self, *, user_id: uuid.UUID, year: int, group_id: uuid.UUID) -> dict:
        # Fold in any archive usernames this user has claimed as their own —
        # the calendar should show their full reading history, not just what
        # was logged under their current account.
        effective_ids = self.claims.effective_user_ids(user_id=user_id)

        all_rounds = self.rounds.list_for_group(group_id=group_id, limit=200)
        year_rounds = [r for r in all_rounds if r.year == year]

        round_ids = [r.id for r in year_rounds]
        logs = self.logs.list_for_user_rounds(round_ids=round_ids, user_ids=effective_ids)
        logs_by_date: dict[date, ReadingLog] = {}
        for log in logs:
            logs_by_date[log.date] = log

        # Determine which months the user (or a claimed identity) participated in
        participated_months: list[int] = []
        for rnd in year_rounds:
            participant = self.rounds.participants.get_for_any_user(round_id=rnd.id, user_ids=effective_ids)
            if participant is not None:
                participated_months.append(rnd.month)

        months: dict[int, list[dict]] = {}
        for month in range(1, 13):
            days_in_month = calendar.monthrange(year, month)[1]
            days = []
            for d in range(1, days_in_month + 1):
                dt = date(year, month, d)
                log = logs_by_date.get(dt)
                days.append({
                    "date": dt.isoformat(),
                    "minutes": int(log.minutes) if log else 0,
                    "comment": log.comment if log else None,
                    "book_finished": bool(log.book_finished) if log else False,
                })
            months[month] = days

        return {"year": year, "months": months, "participated_months": participated_months}

    def yearly_roster(self, *, year: int, group_id: uuid.UUID) -> dict:
        """Public/shared archive: who logged what, per day, across every
        circle in this year — not just the current one, and not scoped to
        any single viewer. Private comments are already redacted."""
        all_rounds = self.rounds.list_for_group(group_id=group_id, limit=200)
        year_rounds = [r for r in all_rounds if r.year == year]
        round_ids = [r.id for r in year_rounds]

        rows = self.logs.roster_for_rounds(round_ids=round_ids)
        by_date: dict[str, list[dict]] = defaultdict(list)
        for d, uid, name, tg, minutes, score, book_finished, comment in rows:
            by_date[d.isoformat()].append({
                "user_id": str(uid),
                "display_name": name,
                "telegram_id": tg,
                "minutes": minutes,
                "score": score,
                "book_finished": book_finished,
                "comment": comment,
            })

        return {"year": year, "days": dict(by_date)}

    def leaderboard(self, *, round_id: uuid.UUID) -> list[dict]:
        rnd = self.rounds.get_round(round_id)
        data = self.logs.leaderboard_data(
            round_id=round_id,
            day_from=rnd.first_day_date if rnd else None,
            day_to=rnd.last_day_date if rnd else None,
        )
        data.sort(key=lambda x: (-x["total_score"], x["display_name"]))
        return data

    def circle_roster(self, *, round_id: uuid.UUID) -> dict:
        """Who logged what, per day, for the whole circle — the shared
        calendar. Visible to anyone logged in, not just people enrolled in
        this particular circle. Private comments are already redacted by
        the repository."""
        rnd = self.rounds.get_round(round_id)
        if rnd is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Round not found")

        rows = self.logs.roster_for_round(round_id=round_id)
        by_date: dict[str, list[dict]] = defaultdict(list)
        for d, uid, name, tg, minutes, score, book_finished, comment in rows:
            # Only the round's own days belong on its shared calendar. Reading
            # logged outside the window still lives in that person's private
            # archive, but it isn't part of this circle and shouldn't show up
            # in the group view or count toward it.
            if not rnd.covers(d):
                continue
            by_date[d.isoformat()].append({
                "user_id": str(uid),
                "display_name": name,
                "telegram_id": tg,
                "minutes": minutes,
                "score": score,
                "book_finished": book_finished,
                "comment": comment,
            })

        return {"round_id": str(round_id), "days": dict(by_date)}
