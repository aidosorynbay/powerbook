from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
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
SEATS = {"round": 12, "library": 6}
# A reader whose page has not checked in for this long has left the room; their sitting is closed and
# the reading up to their last check-in is counted, as if they had pressed «Закончить».
STALE_AFTER = timedelta(seconds=180)
# Nobody reads for twelve hours at a stretch: a sitting this long was left open by mistake.
MAX_SITTING = timedelta(hours=12)
CHAT_WINDOW = timedelta(hours=12)
CHAT_LIMIT = 80
CHAT_GAP = timedelta(seconds=2)
IN_CIRCLE = {RoundParticipantStatus.active, RoundParticipantStatus.locked}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    # SQLite hands timestamps back without a zone; Postgres keeps it. Treat both as UTC.
    return dt.replace(tzinfo=timezone.utc) if dt is not None and dt.tzinfo is None else dt


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
        if hall == "round" and not self.in_circle(rnd, user.id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only this circle's readers sit here")

    # ---------- time ----------

    @staticmethod
    def elapsed_seconds(s: ReadingRoomSession, at: datetime | None = None) -> int:
        at = at or _now()
        run = _aware(s.run_started_at)
        extra = max(0, int((at - run).total_seconds())) if s.status == "reading" and run is not None else 0
        return int(s.accumulated_seconds) + extra

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
        """Close sittings whose readers have gone quiet, counting their reading up to the last check-in."""
        now, alive = _now(), []
        for s in sessions:
            seen = _aware(s.last_seen_at)
            if now - seen > STALE_AFTER or now - _aware(s.created_at or now) > MAX_SITTING:
                self._close(s, at=min(seen, now))
            else:
                alive.append(s)
        return alive

    # ---------- «Сегодня» ----------

    def _today(self):
        return datetime.now(tz=ROUND_TZ).date()

    def today_minutes(self, rnd: Round | None, user_id: uuid.UUID) -> int:
        if rnd is None:
            return 0
        row = ReadingService(self.db).logs.get_for_user_date(round_id=rnd.id, user_id=user_id, day=self._today())
        return int(row.minutes) if row else 0

    def _credit(self, s: ReadingRoomSession, minutes: int) -> str | None:
        """Adds the sitting's minutes to the reader's «Сегодня» in their current circle.
        Returns why nothing was written, or None when it was."""
        if minutes < 1:
            return "short"
        rnd = self.current_round()
        if not self.in_circle(rnd, s.user_id):
            return "not_in_round"
        reading = ReadingService(self.db)
        day = self._today()
        row = reading.logs.get_for_user_date(round_id=rnd.id, user_id=s.user_id, day=day)
        try:
            reading.log_minutes(
                round_id=rnd.id, user_id=s.user_id, day=day,
                minutes=min(24 * 60, (int(row.minutes) if row else 0) + minutes),
                book_finished=bool(row.book_finished) if row else False,
                comment=row.comment if row else None,
                comment_private=bool(row.is_comment_private) if row else False,
            )
        except HTTPException as e:
            self.db.rollback()
            return str(e.detail)
        s.credited_minutes, s.credited_round_id, s.credited_date = minutes, rnd.id, day
        return None

    def _close(self, s: ReadingRoomSession, *, at: datetime | None = None) -> tuple[int, str | None]:
        at = at or _now()
        seconds = self.elapsed_seconds(s, at)
        s.accumulated_seconds, s.run_started_at, s.status, s.ended_at = seconds, None, "ended", at
        why = self._credit(s, seconds // 60)
        self.db.commit()
        return seconds // 60, why

    # ---------- the room ----------

    def state(self, *, hall: str, user: User, since: datetime | None = None) -> dict:
        hall = self._hall(hall)
        rnd = self.current_round()
        scope = self._scope(hall, rnd)
        can_sit = hall == "library" or self.in_circle(rnd, user.id)
        sessions = self._sweep(self._open_sessions(hall, scope)) if hall == "library" or rnd is not None else []
        users = {u.id: u for u in self.db.execute(select(User).where(User.id.in_([s.user_id for s in sessions]))).scalars()} if sessions else {}
        today = self._today()
        logs = {}
        if rnd is not None and sessions:
            rows = self.db.execute(select(ReadingLog).where(
                ReadingLog.round_id == rnd.id, ReadingLog.date == today,
                ReadingLog.user_id.in_([s.user_id for s in sessions]),
            )).scalars()
            logs = {r.user_id: int(r.minutes) for r in rows}
        now = _now()
        readers = []
        for s in sorted(sessions, key=lambda x: x.created_at or now):
            u = users.get(s.user_id)
            if u is None:
                continue
            readers.append({
                "session_id": str(s.id), "user_id": str(u.id), "display_name": u.display_name, "username": u.username,
                "gender": u.gender.value if u.gender else "unknown", "seat": s.seat, "book": s.book_title,
                "status": s.status, "elapsed_seconds": self.elapsed_seconds(s, now),
                "today_minutes": logs.get(s.user_id, 0), "in_round": self.in_circle(rnd, u.id),
                "me": u.id == user.id,
            })
        mine = self._open_for_user(user.id)
        return {
            "hall": hall,
            "seats": SEATS[hall],
            "can_sit": can_sit,
            "round": {"id": str(rnd.id), "year": rnd.year, "month": rnd.month} if rnd else None,
            "in_round": self.in_circle(rnd, user.id),
            "today_minutes": self.today_minutes(rnd, user.id),
            "readers": readers,
            # A sitting in the other hall still counts as mine: the client offers to go back to it.
            "my_session": self._session_out(mine, now) if mine else None,
            "messages": self.messages(hall=hall, rnd=rnd, user=user, since=since) if can_sit else [],
            "server_time": now.isoformat(),
        }

    def _session_out(self, s: ReadingRoomSession, now: datetime | None = None) -> dict:
        return {
            "id": str(s.id), "hall": s.hall, "seat": s.seat, "book": s.book_title, "status": s.status,
            "elapsed_seconds": self.elapsed_seconds(s, now), "credited_minutes": int(s.credited_minutes),
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
        # One sitting at a time: taking a chair gets you up from the one you were in.
        old = self._open_for_user(user.id)
        if old is not None:
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
        if s.ended_at is None:
            s.last_seen_at = _now()
            self.db.commit()
        return self._session_out(s)

    def pause(self, *, session_id: uuid.UUID, user: User) -> dict:
        s = self._mine(session_id, user)
        now = _now()
        if s.ended_at is None and s.status == "reading":
            s.accumulated_seconds, s.run_started_at, s.status = self.elapsed_seconds(s, now), None, "paused"
        s.last_seen_at = now
        self.db.commit()
        return self._session_out(s)

    def resume(self, *, session_id: uuid.UUID, user: User) -> dict:
        s = self._mine(session_id, user)
        now = _now()
        if s.ended_at is None and s.status == "paused":
            s.run_started_at, s.status = now, "reading"
        s.last_seen_at = now
        self.db.commit()
        return self._session_out(s)

    def finish(self, *, session_id: uuid.UUID, user: User) -> dict:
        s = self._mine(session_id, user)
        if s.ended_at is not None:
            minutes, why = int(s.accumulated_seconds) // 60, None if s.credited_minutes else "already_ended"
        else:
            minutes, why = self._close(s)
        rnd = self.current_round()
        return {
            "minutes": minutes, "credited": int(s.credited_minutes) > 0, "reason": why,
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
            reading.log_minutes(
                round_id=s.credited_round_id, user_id=user.id, day=s.credited_date,
                minutes=max(0, int(row.minutes) - int(s.credited_minutes)),
                book_finished=bool(row.book_finished), comment=row.comment,
                comment_private=bool(row.is_comment_private),
            )
        s.credited_minutes = 0
        self.db.commit()
        return {"today_minutes": self.today_minutes(self.current_round(), user.id)}

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
