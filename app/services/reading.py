from __future__ import annotations

import calendar
import uuid
from collections import defaultdict
from datetime import date, datetime
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.enums import RoundParticipantStatus, RoundStatus
from app.models.round import ReadingLog, ReadingLogBook
from app.repositories.claims import ClaimsRepository
from app.repositories.insights import normalize_book_title
from app.repositories.reading_logs import ReadingLogRepository
from app.services.rounds import RoundService

from app.core.constants import CORRECTION_DEADLINE_HOUR, CORRECTION_TZ

# «Что читаю» offers this many books beyond the current one.
RECENT_BOOKS = 8


def _title_norm(title: str) -> str:
    return normalize_book_title(title) or title.casefold()


def _clean_books(books) -> list[dict]:
    """The day's books as the form sent them: blank titles dropped, the same
    book named twice folded into one row."""
    out: list[dict] = []
    by_norm: dict[str, dict] = {}
    for b in books:
        title = " ".join((b.title or "").split())[:300]
        if not title:
            continue
        norm = _title_norm(title)
        if norm in by_norm:
            by_norm[norm]["minutes"] += b.minutes
            by_norm[norm]["finished"] = by_norm[norm]["finished"] or b.finished
            continue
        row = {"title": title, "norm": norm, "minutes": b.minutes, "finished": b.finished}
        by_norm[norm] = row
        out.append(row)
    return out


def _comment_with_title(comment: str | None, title: str) -> str:
    """A finished day's comment starts with the book's title.

    The shelf, the covers and «кто ещё читал» all read the title from the
    comment's first line, the way readers have written it since the Telegram
    days. Thoughts the reader wrote stay below it.
    """
    text = (comment or "").strip()
    if not text:
        return title
    first = text.split("\n", 1)[0]
    if normalize_book_title(first) == _title_norm(title):
        return text
    return f"{title}\n{text}"


class _Book:
    def __init__(self, title: str, minutes: int, finished: bool) -> None:
        self.title, self.minutes, self.finished = title, minutes, finished


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
        books: list | None = None,
        started_on: date | None = None,
    ) -> ReadingLog:
        """`started_on`: the day the book finished today was begun, so that
        days with no book named since then count for it (book_finish.py)."""
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

        # Which books the minutes went to. One book takes the whole day unless
        # its own minutes are given; split minutes never exceed the day's
        # total — if they do, the total grows to match them.
        day_books = _clean_books(books) if books is not None else None
        finished_title = None
        if day_books:
            if len(day_books) == 1 and day_books[0]["minutes"] == 0:
                day_books[0]["minutes"] = minutes
            minutes = max(minutes, sum(b["minutes"] for b in day_books))
            if book_finished and not any(b["finished"] for b in day_books) and len(day_books) == 1:
                day_books[0]["finished"] = True
            done = [b for b in day_books if b["finished"]]
            if done:
                book_finished = True
                comment = _comment_with_title(comment, done[0]["title"])
                finished_title = done[0]["title"]

        # Last day date itself: allow logging but score=0
        force_score = 0 if day == last_day_date else None
        before = self.logs.get_for_user_date(round_id=round_id, user_id=user_id, day=day)
        was_public_finish = bool(
            before and before.book_finished and not before.is_comment_private and before.comment == comment
        )
        row = self.logs.upsert_minutes(
            round_id=round_id, user_id=user_id, day=day, minutes=minutes,
            force_score=force_score, book_finished=book_finished, comment=comment,
            comment_private=comment_private,
        )
        if day_books is not None:
            row.books.clear()
            self.db.flush()
            for i, b in enumerate(day_books):
                row.books.append(ReadingLogBook(
                    user_id=user_id, title=b["title"], title_norm=b["norm"],
                    minutes=b["minutes"], finished=b["finished"], position=i,
                ))
            self.db.commit()
        elif len(row.books) == 1 and row.books[0].minutes != row.minutes:
            # An older page changed the total of a one-book day: the book follows.
            row.books[0].minutes = row.minutes
            self.db.commit()
        if started_on is not None and book_finished:
            if finished_title is None and comment and not row.books:
                from app.services.bookcase import _split_comment

                finished_title = _split_comment(comment)[0]
            if finished_title:
                from app.services import book_finish

                book_finish.give_days(self.db, user_id=user_id, title=finished_title, day=day, start=started_on)
        # A book finished in the open: whoever watches it hears (app/services/notify.py).
        if book_finished and comment and not comment_private and not was_public_finish:
            from app.services import notify

            notify.on_finished(self.db, reader_id=user_id, comment=comment, day=day)
        return row

    def log_session(
        self, *, round_id: uuid.UUID, user_id: uuid.UUID, day: date, minutes: int, title: str | None,
    ) -> ReadingLog:
        """Minutes read in the reader, added to the day without touching what
        the reader already wrote for it: the comment, «Книга прочитана», the
        other books of the day."""
        before = self.logs.get_for_user_date(round_id=round_id, user_id=user_id, day=day)
        total = (int(before.minutes) if before else 0) + minutes
        books = None
        if title and title.strip():
            norm = _title_norm(" ".join(title.split()))
            books = [_Book(b.title, b.minutes, b.finished) for b in (before.books if before else [])]
            for b in books:
                if _title_norm(b.title) == norm:
                    b.minutes += minutes
                    break
            else:
                books.append(_Book(title, minutes, False))
        return self.log_minutes(
            round_id=round_id, user_id=user_id, day=day, minutes=total,
            book_finished=bool(before and before.book_finished),
            comment=before.comment if before else None,
            comment_private=bool(before and before.is_comment_private),
            books=books,
        )

    def reading_books(self, *, user_id: uuid.UUID) -> dict:
        """The book(s) of the reader's latest day that they have not finished,
        and other books they read lately and have not finished either."""
        ids = list(self.claims.effective_user_ids(user_id=user_id))
        rows = self.db.execute(
            select(ReadingLogBook.title, ReadingLogBook.title_norm, ReadingLogBook.finished, ReadingLog.date)
            .join(ReadingLog, ReadingLog.id == ReadingLogBook.reading_log_id)
            .where(ReadingLogBook.user_id.in_(ids))
            .order_by(ReadingLog.date.desc(), ReadingLogBook.position.asc())
            .limit(300)
        ).all()
        latest_day = rows[0].date if rows else None
        current: list[str] = []
        recent: list[str] = []
        seen: set[str] = set()
        for title, norm, finished, d in rows:
            if norm in seen:
                continue
            seen.add(norm)
            if finished:
                # Its latest mention is the day it was finished: done with.
                continue
            if d == latest_day:
                current.append(title)
            elif len(recent) < RECENT_BOOKS:
                recent.append(title)
        return {"current": current, "recent": recent}

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
                # What the day was read on is the reader's own business.
                "books": [
                    {"title": b.title, "minutes": int(b.minutes), "finished": bool(b.finished)}
                    for b in row.books
                ] if row is not None and is_owner else [],
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
