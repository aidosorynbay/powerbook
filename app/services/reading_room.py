from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.constants import DEFAULT_GROUP_SLUG, ROUND_TZ
from app.models.enums import RoundParticipantStatus, RoundStatus
from app.models.reading_room import ReadingRoomMessage, ReadingRoomSession
from app.models.round import ReadingLog, Round
from app.models.user import User
from app.repositories.participants import RoundParticipantRepository
from app.services.groups import GroupService
from app.services.reading import ReadingService

# Chairs in each hall's photo, in the order the client maps them (frontend/src/widgets/ReadingRoom/engine.js, HALLS).
# The library has eleven: six in the wide photo and all eleven in the phones' portrait one.
SEATS = {"round": 12, "library": 11}
# Phones and iPads stop a page the moment the screen locks or another app comes to the front, so a reader with a paper
# book (or a book in another app) goes quiet while still reading. A sitting not heard from for this long is shown to the
# others as stopped where the room last heard from it ...
AWAY_AFTER = timedelta(seconds=180)
# ... but it keeps its chair. When the reader's page is back, the silent stretch is set aside and the reader is asked
# whether they read through it (only they know). Not heard from for this long, the page was closed or forgotten: the
# sitting is closed and the reading up to its last check-in is counted, as if they had pressed «Закончить».
GONE_AFTER = timedelta(hours=2)
# Nobody reads for twelve hours at a stretch: a sitting this long was left open by mistake.
MAX_SITTING = timedelta(hours=12)
CHAT_WINDOW = timedelta(hours=12)
CHAT_LIMIT = 80
CHAT_GAP = timedelta(seconds=2)
# The reading day turns at 03:00 Astana time, not at midnight: a sitting finished at 02:00 on the 30th is the 29th's
# reading, and its minutes go to the 29th.
DAY_TURNS_AT = timedelta(hours=3)
# Once the day has turned, a reader can still be finishing last night's reading: a sitting begun before 03:00, or one
# finished in the small hours (up to 06:00), may belong to either day, and the reader is asked which (2026-10-07).
ASK_DAY_UNTIL = timedelta(hours=3)
# How many of the day's comings and goings the chat shows.
EVENTS_LIMIT = 60
IN_CIRCLE = {RoundParticipantStatus.active, RoundParticipantStatus.locked}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    # SQLite hands timestamps back without a zone; Postgres keeps it. Treat both as UTC.
    return dt.replace(tzinfo=timezone.utc) if dt is not None and dt.tzinfo is None else dt


def reading_day(at: datetime | None = None) -> date:
    """The day a moment's reading belongs to (see DAY_TURNS_AT)."""
    return ((at or _now()).astimezone(ROUND_TZ) - DAY_TURNS_AT).date()


def reading_day_start(day: date) -> datetime:
    """When that reading day began, in UTC."""
    return (datetime.combine(day, time(0), tzinfo=ROUND_TZ) + DAY_TURNS_AT).astimezone(timezone.utc)


class ReadingRoomService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.participants = RoundParticipantRepository(db)

    # ---------- who may do what ----------

    def current_round(self) -> Round | None:
        groups = GroupService(self.db)
        return groups.get_current_round(group_id=groups.get_by_slug(slug=DEFAULT_GROUP_SLUG).id)

    def in_circle(self, rnd: Round | None, user_id: uuid.UUID) -> bool:
        if rnd is None or rnd.status in {RoundStatus.closed, RoundStatus.results_published}:
            return False
        p = self.participants.get_for_user(round_id=rnd.id, user_id=user_id)
        return p is not None and p.status in IN_CIRCLE

    def _hall(self, hall: str) -> str:
        if hall not in SEATS:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such hall")
        return hall

    def _scope(self, hall: str, rnd: Round | None) -> uuid.UUID | None:
        """The round hall is the current circle's room; the library hall has no circle."""
        return rnd.id if hall == "round" and rnd is not None else None

    def _require_seatable(self, hall: str, rnd: Round | None, user: User) -> None:
        # For now the circle's room is open to every reader (the library leads there too); only the circle's own
        # readers get their minutes into its calendar (see _credit). It needs a circle to belong to.
        if hall == "round" and rnd is None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="No round")

    # ---------- time ----------

    @staticmethod
    def elapsed_seconds(s: ReadingRoomSession, at: datetime | None = None) -> int:
        at = at or _now()
        run = _aware(s.run_started_at)
        extra = max(0, int((at - run).total_seconds())) if s.status == "reading" and run is not None else 0
        return int(s.accumulated_seconds) + extra

    @staticmethod
    def _away(s: ReadingRoomSession, now: datetime) -> bool:
        return now - _aware(s.last_seen_at) > AWAY_AFTER

    def _gone(self, s: ReadingRoomSession, now: datetime) -> bool:
        return now - _aware(s.last_seen_at) > GONE_AFTER or now - _aware(s.created_at or now) > MAX_SITTING

    def _back(self, s: ReadingRoomSession, now: datetime) -> None:
        """The reader's page is heard from again. Gone too long, the sitting is closed as the sweep would close it.
        Otherwise a silence of AWAY_AFTER or more while the clock ran is set aside for the reader to answer for
        (answer_away), and the clock goes on from now."""
        if s.ended_at is not None:
            return
        seen = _aware(s.last_seen_at)
        if self._gone(s, now):
            self._close(s, at=min(seen, now))
            return
        if self._away(s, now) and s.status == "reading" and s.run_started_at is not None:
            counted = self.elapsed_seconds(s, seen)
            s.away_seconds = int(s.away_seconds or 0) + self.elapsed_seconds(s, now) - counted
            s.accumulated_seconds, s.run_started_at = counted, now
        s.last_seen_at = now

    def _open_sessions(self, hall: str, scope: uuid.UUID | None) -> list[ReadingRoomSession]:
        stmt = select(ReadingRoomSession).where(
            ReadingRoomSession.hall == hall,
            ReadingRoomSession.ended_at.is_(None),
            ReadingRoomSession.round_id.is_(None) if scope is None else ReadingRoomSession.round_id == scope,
        )
        return list(self.db.execute(stmt).scalars().all())

    def _open_for_user(self, user_id: uuid.UUID) -> ReadingRoomSession | None:
        stmt = select(ReadingRoomSession).where(
            ReadingRoomSession.user_id == user_id, ReadingRoomSession.ended_at.is_(None)
        )
        return self.db.execute(stmt).scalars().first()

    def _sweep(self, sessions: list[ReadingRoomSession]) -> list[ReadingRoomSession]:
        """Close sittings whose readers are gone, counting their reading up to the last check-in."""
        now, alive = _now(), []
        for s in sessions:
            if self._gone(s, now):
                self._close(s, at=min(_aware(s.last_seen_at), now))
            else:
                alive.append(s)
        return alive

    # ---------- the reading day ----------

    def _today(self) -> date:
        return reading_day()

    def today_minutes(self, rnd: Round | None, user_id: uuid.UUID) -> int:
        if rnd is None:
            return 0
        row = ReadingService(self.db).logs.get_for_user_date(round_id=rnd.id, user_id=user_id, day=self._today())
        return int(row.minutes) if row else 0

    def _credit(self, s: ReadingRoomSession, minutes: int, day: date) -> str | None:
        """Adds the sitting's minutes to the reader's day in their current circle.
        Returns why nothing was written, or None when it was."""
        if minutes < 1:
            return "short"
        rnd = self.current_round()
        if not self.in_circle(rnd, s.user_id):
            return "not_in_round"
        reading = ReadingService(self.db)
        row = reading.logs.get_for_user_date(round_id=rnd.id, user_id=s.user_id, day=day)
        minutes = min(minutes, max(0, 24 * 60 - (int(row.minutes) if row else 0)))
        try:
            # on the book the reader sat down with: its minutes are the same book's on the shelf and in «Что читаю»
            reading.log_session(round_id=rnd.id, user_id=s.user_id, day=day, minutes=minutes, title=s.book_title)
        except HTTPException as e:
            self.db.rollback()
            return str(e.detail)
        s.credited_minutes, s.credited_round_id, s.credited_date = minutes, rnd.id, day
        return None

    def day_choices(self, s: ReadingRoomSession, now: datetime, rnd: Round | None = None) -> list[date]:
        """The days a sitting's minutes may go to when the reader has to be asked (none when there is no question):
        last night's and today's, after 03:00 under a sitting begun the day before, or in the small hours. Only for a
        reader of the current circle, and only days the circle takes minutes for."""
        today = reading_day(now)
        began = reading_day(_aware(s.created_at) or now)
        if began == today and now - reading_day_start(today) >= ASK_DAY_UNTIL:
            return []
        rnd = rnd or self.current_round()
        if not self.in_circle(rnd, s.user_id):
            return []
        days = [d for d in (today - timedelta(days=1), today) if rnd.covers(d)]
        return days if len(days) == 2 else []

    def _close(self, s: ReadingRoomSession, *, at: datetime | None = None, day: date | None = None) -> tuple[int, str | None]:
        at = at or _now()
        seconds = self.elapsed_seconds(s, at)
        s.accumulated_seconds, s.run_started_at, s.status, s.ended_at = seconds, None, "ended", at
        # a sitting closed long after its reader left goes to the day they left on, not the day it was noticed
        why = self._credit(s, seconds // 60, day or reading_day(at))
        self.db.commit()
        return seconds // 60, why

    # ---------- the room ----------

    def state(self, *, hall: str, user: User, since: datetime | None = None) -> dict:
        hall = self._hall(hall)
        rnd = self.current_round()
        scope = self._scope(hall, rnd)
        can_sit = hall == "library" or rnd is not None
        sessions = self._sweep(self._open_sessions(hall, scope)) if hall == "library" or rnd is not None else []
        now = _now()
        # my own page asking is word from me: a silence before it is set aside for me to answer for (the heartbeat
        # keeps last_seen_at fresh otherwise, so nothing is written on an ordinary poll)
        mine = self._open_for_user(user.id)
        if mine is not None and self._away(mine, now):
            self._back(mine, now)
            self.db.commit()
            if mine.ended_at is not None:
                mine = None
        users = {u.id: u for u in self.db.execute(select(User).where(User.id.in_([s.user_id for s in sessions]))).scalars()} if sessions else {}
        today = self._today()
        logs = {}
        if rnd is not None and sessions:
            rows = self.db.execute(select(ReadingLog).where(
                ReadingLog.round_id == rnd.id, ReadingLog.date == today,
                ReadingLog.user_id.in_([s.user_id for s in sessions]),
            )).scalars()
            logs = {r.user_id: int(r.minutes) for r in rows}
        readers = []
        # each sitter's minutes on their book before this sitting (book_time): «всего на книге» on their tag
        from app.services import book_time

        before = dict(zip((s.id for s in sessions), book_time.of_sitters(self.db, [(s.user_id, s.book_title) for s in sessions])))
        for s in sorted(sessions, key=lambda x: x.created_at or now):
            u = users.get(s.user_id)
            if u is None:
                continue
            me = u.id == user.id
            # someone else's page gone quiet: what the room knows is their reading up to the last word from it
            away = not me and self._away(s, now)
            readers.append({
                "session_id": str(s.id), "user_id": str(u.id), "display_name": u.display_name, "username": u.username,
                "gender": u.gender.value if u.gender else "unknown", "seat": s.seat, "book": s.book_title,
                "status": "paused" if away else s.status,
                "elapsed_seconds": self.elapsed_seconds(s, _aware(s.last_seen_at) if away else now),
                "today_minutes": logs.get(s.user_id, 0), "in_round": self.in_circle(rnd, u.id),
                "book_minutes": before.get(s.id, 0), "me": me,
            })
        return {
            "hall": hall,
            "seats": SEATS[hall],
            "can_sit": can_sit,
            "round": {"id": str(rnd.id), "year": rnd.year, "month": rnd.month} if rnd else None,
            "in_round": self.in_circle(rnd, user.id),
            "today_minutes": self.today_minutes(rnd, user.id),
            "readers": readers,
            # A sitting in the other hall still counts as mine: the client offers to go back to it. «days»: the two
            # days to ask about on «Закончить» (see day_choices), or none.
            "my_session": {**self._session_out(mine, now), "days": [d.isoformat() for d in self.day_choices(mine, now, rnd)]}
            if mine else None,
            "messages": self.messages(hall=hall, rnd=rnd, user=user, since=since) if can_sit else [],
            "reading_day": today.isoformat(),
            "day": self.day(hall=hall, scope=scope, now=now) if can_sit and (hall == "library" or rnd is not None) else None,
            "server_time": now.isoformat(),
        }

    def _session_out(self, s: ReadingRoomSession, now: datetime | None = None) -> dict:
        return {
            "id": str(s.id), "hall": s.hall, "seat": s.seat, "book": s.book_title, "status": s.status,
            "elapsed_seconds": self.elapsed_seconds(s, now), "credited_minutes": int(s.credited_minutes),
            # a silence the reader has not answered for yet (see answer_away)
            "away_seconds": int(s.away_seconds or 0) if s.ended_at is None else 0,
        }

    def sit(self, *, hall: str, user: User, seat: int, book: str) -> dict:
        hall = self._hall(hall)
        book = " ".join(book.split())[:200]
        if not book:
            raise HTTPException(status_code=422, detail="Book is required")
        if not 0 <= seat < SEATS[hall]:
            raise HTTPException(status_code=422, detail="No such chair")
        rnd = self.current_round()
        self._require_seatable(hall, rnd, user)
        # One sitting at a time: taking a chair gets you up from the one you were in (a silence in it unanswered for
        # is left out).
        old = self._open_for_user(user.id)
        if old is not None:
            self._back(old, _now())
            if old.ended_at is None:
                self._close(old)
        scope = self._scope(hall, rnd)
        if any(s.seat == seat for s in self._sweep(self._open_sessions(hall, scope))):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Chair is taken")
        now = _now()
        s = ReadingRoomSession(
            user_id=user.id, hall=hall, round_id=scope, seat=seat, book_title=book,
            status="reading", accumulated_seconds=0, run_started_at=now, last_seen_at=now,
        )
        self.db.add(s)
        self.db.commit()
        self.db.refresh(s)
        return self._session_out(s)

    def _mine(self, session_id: uuid.UUID, user: User) -> ReadingRoomSession:
        s = self.db.get(ReadingRoomSession, session_id)
        if s is None or s.user_id != user.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
        return s

    def heartbeat(self, *, session_id: uuid.UUID, user: User) -> dict:
        s = self._mine(session_id, user)
        self._back(s, _now())
        self.db.commit()
        return self._session_out(s)

    def answer_away(self, *, session_id: uuid.UUID, user: User, count: bool) -> dict:
        """The reader says whether they read while their page was silent: if they did, that time joins the sitting."""
        s = self._mine(session_id, user)
        now = _now()
        self._back(s, now)
        if s.ended_at is None:
            if count:
                s.accumulated_seconds = int(s.accumulated_seconds) + int(s.away_seconds or 0)
            s.away_seconds = 0
        self.db.commit()
        return self._session_out(s, now)

    def pause(self, *, session_id: uuid.UUID, user: User) -> dict:
        s = self._mine(session_id, user)
        now = _now()
        self._back(s, now)
        if s.ended_at is None and s.status == "reading":
            s.accumulated_seconds, s.run_started_at, s.status = self.elapsed_seconds(s, now), None, "paused"
        s.last_seen_at = now
        self.db.commit()
        return self._session_out(s)

    def resume(self, *, session_id: uuid.UUID, user: User) -> dict:
        s = self._mine(session_id, user)
        now = _now()
        self._back(s, now)
        if s.ended_at is None and s.status == "paused":
            s.run_started_at, s.status = now, "reading"
        s.last_seen_at = now
        self.db.commit()
        return self._session_out(s)

    def finish(self, *, session_id: uuid.UUID, user: User, day: date | None = None) -> dict:
        """Gets the reader up. `day`: their answer to «за какой день?», taken when it is one of day_choices."""
        s = self._mine(session_id, user)
        now = _now()
        # (a silence not answered for stays out: the page asks about it before «Закончить» is offered)
        self._back(s, now)
        if s.ended_at is not None:
            minutes, why = int(s.accumulated_seconds) // 60, None if s.credited_minutes else "already_ended"
        else:
            minutes, why = self._close(s, at=now, day=day if day is not None and day in self.day_choices(s, now) else None)
        rnd = self.current_round()
        return {
            "minutes": minutes, "credited": int(s.credited_minutes) > 0, "reason": why,
            # the reading day the minutes went to (before 03:00 it is the day before)
            "date": s.credited_date.isoformat() if s.credited_date else None,
            "today_minutes": self.today_minutes(rnd, user.id),
        }

    def undo(self, *, session_id: uuid.UUID, user: User) -> dict:
        """Takes the sitting's minutes back out of «Сегодня»."""
        s = self._mine(session_id, user)
        if s.ended_at is None or not s.credited_minutes or s.credited_round_id is None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Nothing to undo")
        reading = ReadingService(self.db)
        row = reading.logs.get_for_user_date(round_id=s.credited_round_id, user_id=user.id, day=s.credited_date)
        if row is not None:
            reading.take_back(
                round_id=s.credited_round_id, user_id=user.id, day=s.credited_date,
                minutes=int(s.credited_minutes), title=s.book_title,
            )
        s.credited_minutes = 0
        self.db.commit()
        return {"today_minutes": self.today_minutes(self.current_round(), user.id)}

    # ---------- the day in the hall, for the chat ----------

    def day(self, *, hall: str, scope: uuid.UUID | None, now: datetime) -> dict:
        """Who came to the hall this reading day and when: each sitting down with a book and each getting up with
        its minutes, plus a line for the top of the chat (how many read and for how long together).
        A sitting under a minute that has ended was a chair taken by mistake and is left out."""
        today = reading_day(now)
        start = reading_day_start(today)
        stmt = (
            select(ReadingRoomSession, User)
            .join(User, User.id == ReadingRoomSession.user_id)
            .where(
                ReadingRoomSession.hall == hall,
                ReadingRoomSession.round_id.is_(None) if scope is None else ReadingRoomSession.round_id == scope,
                or_(ReadingRoomSession.created_at >= start, ReadingRoomSession.ended_at >= start,
                    ReadingRoomSession.ended_at.is_(None)),
            )
            .order_by(ReadingRoomSession.created_at)
        )
        events, people, minutes = [], {}, 0
        for s, u in self.db.execute(stmt).all():
            ended = _aware(s.ended_at)
            if ended is None:
                seconds = self.elapsed_seconds(s, _aware(s.last_seen_at) if self._away(s, now) else now)
            else:
                seconds = int(s.accumulated_seconds)
            if ended is not None and seconds < 60:
                continue
            people.setdefault(u.id, u.display_name)
            minutes += seconds // 60
            who = {"user_id": str(u.id), "display_name": u.display_name,
                   "gender": u.gender.value if u.gender else "unknown", "book": s.book_title}
            created = _aware(s.created_at)
            if created is not None and created >= start:
                events.append({"kind": "sit", "at": created.isoformat(), **who})
            if ended is not None and ended >= start:
                events.append({"kind": "finish", "at": ended.isoformat(), "minutes": seconds // 60, **who})
        events.sort(key=lambda e: e["at"])
        return {
            "date": today.isoformat(), "readers": len(people), "names": list(people.values())[:4],
            "minutes": minutes, "events": events[-EVENTS_LIMIT:],
        }

    # ---------- chat ----------

    def messages(self, *, hall: str, rnd: Round | None, user: User, since: datetime | None) -> list[dict]:
        scope = self._scope(hall, rnd)
        if hall == "round" and scope is None:
            return []
        start = max(_aware(since), _now() - CHAT_WINDOW) if since else _now() - CHAT_WINDOW
        stmt = (
            select(ReadingRoomMessage, User.display_name)
            .join(User, User.id == ReadingRoomMessage.user_id)
            .where(
                ReadingRoomMessage.hall == hall,
                ReadingRoomMessage.round_id.is_(None) if scope is None else ReadingRoomMessage.round_id == scope,
                ReadingRoomMessage.created_at > start,
            )
            .order_by(ReadingRoomMessage.created_at.desc())
            .limit(CHAT_LIMIT)
        )
        rows = list(self.db.execute(stmt).all())[::-1]
        return [{
            "id": str(m.id), "user_id": str(m.user_id), "display_name": name, "text": m.text,
            "created_at": _aware(m.created_at).isoformat(), "me": m.user_id == user.id,
        } for m, name in rows]

    def post_message(self, *, hall: str, user: User, text: str) -> dict:
        hall = self._hall(hall)
        text = " ".join(text.split())[:300]
        if not text:
            raise HTTPException(status_code=422, detail="Empty message")
        rnd = self.current_round()
        self._require_seatable(hall, rnd, user)
        last = self.db.execute(
            select(ReadingRoomMessage.created_at).where(ReadingRoomMessage.user_id == user.id)
            .order_by(ReadingRoomMessage.created_at.desc()).limit(1)
        ).scalar_one_or_none()
        now = _now()
        if last is not None and now - _aware(last) < CHAT_GAP:
            raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too fast")
        m = ReadingRoomMessage(hall=hall, round_id=self._scope(hall, rnd), user_id=user.id, text=text, created_at=now)
        self.db.add(m)
        self.db.commit()
        return {
            "id": str(m.id), "user_id": str(user.id), "display_name": user.display_name, "text": m.text,
            "created_at": now.isoformat(), "me": True,
        }
