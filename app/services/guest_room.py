"""Reading in the library hall without an account (the front page's «Начать читать»).

A visitor takes a free chair with a book; their browser keeps a secret token for the sitting, the server only its
hash. The room shows them like anyone else (a figure, a timer, the book; never a name). When they get up they may keep
the minutes: after signing up or logging in, `claim` turns the sitting into one of their own ReadingRoomSession rows,
credited like any sitting (into the circle's day when they are in the circle).
"""
from __future__ import annotations

import hashlib
import re
import secrets
import threading
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.reading_room import GuestRoomSitting, ReadingRoomSession
from app.models.user import User
from app.services.reading_room import AWAY_AFTER, MAX_SITTING, SEATS, ReadingRoomService, reading_day

# Visitors read in the library hall: the circle's own room is for its readers.
GUEST_HALL = "library"
GENDERS = {"female", "male", "unknown"}
# Chairs always left for readers with an account: visitors can never fill the whole hall.
KEPT_FOR_READERS = 3
# A visitor's chair is let go after this long without a word from their page (members keep theirs 2 h): long enough
# for a phone locked beside a paper book, short enough that a closed tab doesn't hold a chair all evening.
GUEST_GONE_AFTER = timedelta(minutes=60)
# New sittings one address may start (per API worker): a few re-tries are fine, a script filling chairs is not.
SITS_PER_ADDRESS = 4
SITS_WINDOW_SECONDS = 600
# A title is a book's name: no links, no handles (anything typed here is shown in the room).
_NOT_A_TITLE = re.compile(r"(https?://|www\.|\.(com|ru|kz|net|org|io|me)\b|t\.me/|@\w)", re.IGNORECASE)

_sits: dict[str, deque[float]] = defaultdict(deque)
_sits_lock = threading.Lock()


def _allow_sit(address: str | None) -> bool:
    if not address:
        return True
    now = time.monotonic()
    with _sits_lock:
        q = _sits[address]
        while q and now - q[0] > SITS_WINDOW_SECONDS:
            q.popleft()
        if len(q) >= SITS_PER_ADDRESS:
            return False
        q.append(now)
        return True


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    return dt.replace(tzinfo=timezone.utc) if dt is not None and dt.tzinfo is None else dt


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def public_key(sitting_id: uuid.UUID) -> str:
    """The key the public room shows for a sitting (the same scheme as members' sittings)."""
    return hashlib.sha1(str(sitting_id).encode()).hexdigest()[:12]


def elapsed(g: GuestRoomSitting, at: datetime | None = None) -> int:
    at = at or _now()
    run = _aware(g.run_started_at)
    extra = max(0, int((at - run).total_seconds())) if g.status == "reading" and run is not None else 0
    return int(g.accumulated_seconds) + extra


def is_away(g: GuestRoomSitting, now: datetime) -> bool:
    return now - _aware(g.last_seen_at) > AWAY_AFTER


def is_gone(g: GuestRoomSitting, now: datetime) -> bool:
    return now - _aware(g.last_seen_at) > GUEST_GONE_AFTER or now - (_aware(g.created_at) or now) > MAX_SITTING


class GuestRoomService:
    def __init__(self, db: Session) -> None:
        self.db = db

    # ---------- who sits where ----------

    def open_sittings(self, hall: str) -> list[GuestRoomSitting]:
        """Visitors in a hall now; a sitting gone quiet for hours is closed at its last word."""
        rows = self.db.execute(
            select(GuestRoomSitting).where(GuestRoomSitting.hall == hall, GuestRoomSitting.ended_at.is_(None))
        ).scalars().all()
        now, alive, changed = _now(), [], False
        for g in rows:
            if is_gone(g, now):
                self._close(g, at=min(_aware(g.last_seen_at), now))
                changed = True
            else:
                alive.append(g)
        if changed:
            self.db.commit()
        return alive

    def _close(self, g: GuestRoomSitting, *, at: datetime) -> None:
        g.accumulated_seconds, g.run_started_at, g.status, g.ended_at = elapsed(g, at), None, "ended", at

    def _mine(self, sitting_id: uuid.UUID, token: str, *, lock: bool = False) -> GuestRoomSitting:
        # claim locks the row: two tabs (or the page and the app shell) keeping the same sitting at once must not
        # credit it twice
        g = self.db.execute(
            select(GuestRoomSitting).where(GuestRoomSitting.id == sitting_id).with_for_update() if lock
            else select(GuestRoomSitting).where(GuestRoomSitting.id == sitting_id)
        ).scalar_one_or_none()
        if g is None or not token or not secrets.compare_digest(g.token_hash, _hash(token)):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sitting not found")
        return g

    def _back(self, g: GuestRoomSitting, now: datetime) -> None:
        """Word from the visitor's page. Gone too long, the sitting is closed at its last word. A silence of
        AWAY_AFTER or more while the clock ran (a locked phone beside a paper book) is set aside for the visitor to
        answer for (answer_away), and the clock goes on from now."""
        if g.ended_at is not None:
            return
        seen = _aware(g.last_seen_at)
        if is_gone(g, now):
            self._close(g, at=min(seen, now))
            return
        if is_away(g, now) and g.status == "reading" and g.run_started_at is not None:
            counted = elapsed(g, seen)
            g.away_seconds = int(g.away_seconds or 0) + elapsed(g, now) - counted
            g.accumulated_seconds, g.run_started_at = counted, now
        g.last_seen_at = now

    def out(self, g: GuestRoomSitting) -> dict:
        return {
            "id": str(g.id), "key": public_key(g.id), "hall": g.hall, "seat": g.seat, "book": g.book_title,
            "status": g.status, "elapsed_seconds": elapsed(g), "away_seconds": int(g.away_seconds or 0),
            "ended": g.ended_at is not None,
            "claimed": g.claimed_session_id is not None,
        }

    # ---------- the visitor's sitting ----------

    def seats_left(self) -> int:
        """Chairs a visitor may still take in the guests' hall."""
        if not settings.guest_room_enabled:
            return 0
        taken = ReadingRoomService(self.db).taken_seats(GUEST_HALL)
        free = SEATS[GUEST_HALL] - len(taken)
        guests = len(self.open_sittings(GUEST_HALL))
        return max(0, min(free, SEATS[GUEST_HALL] - KEPT_FOR_READERS - guests))

    def sit(self, *, seat: int, book: str, gender: str, address: str | None = None) -> dict:
        if not settings.guest_room_enabled:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Guest reading is off")
        # the title is optional: a visitor who just wants to start reads «Книга»
        book = " ".join((book or "").split())[:200]
        if _NOT_A_TITLE.search(book):
            raise HTTPException(status_code=422, detail="Not a book title")
        if not _allow_sit(address):
            raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many sittings")
        if not 0 <= seat < SEATS[GUEST_HALL]:
            raise HTTPException(status_code=422, detail="No such chair")
        if seat in ReadingRoomService(self.db).taken_seats(GUEST_HALL):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Chair is taken")
        if len(self.open_sittings(GUEST_HALL)) >= SEATS[GUEST_HALL] - KEPT_FOR_READERS:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Hall is full for guests")
        token = secrets.token_urlsafe(24)
        now = _now()
        g = GuestRoomSitting(
            token_hash=_hash(token), hall=GUEST_HALL, seat=seat, book_title=book or "Книга",
            gender=gender if gender in GENDERS else "unknown",
            status="reading", accumulated_seconds=0, run_started_at=now, last_seen_at=now,
        )
        self.db.add(g)
        self.db.commit()
        self.db.refresh(g)
        return {**self.out(g), "token": token}

    def heartbeat(self, *, sitting_id: uuid.UUID, token: str) -> dict:
        g = self._mine(sitting_id, token)
        self._back(g, _now())
        self.db.commit()
        return self.out(g)

    def answer_away(self, *, sitting_id: uuid.UUID, token: str, count: bool) -> dict:
        """The visitor says whether they read while their page was silent: if they did, that time joins the sitting."""
        g = self._mine(sitting_id, token)
        self._back(g, _now())
        if g.ended_at is None:
            if count:
                g.accumulated_seconds = int(g.accumulated_seconds) + int(g.away_seconds or 0)
            g.away_seconds = 0
        self.db.commit()
        return self.out(g)

    def pause(self, *, sitting_id: uuid.UUID, token: str) -> dict:
        g = self._mine(sitting_id, token)
        now = _now()
        self._back(g, now)
        if g.ended_at is None and g.status == "reading":
            g.accumulated_seconds, g.run_started_at, g.status = elapsed(g, now), None, "paused"
        self.db.commit()
        return self.out(g)

    def resume(self, *, sitting_id: uuid.UUID, token: str) -> dict:
        g = self._mine(sitting_id, token)
        now = _now()
        self._back(g, now)
        if g.ended_at is None and g.status == "paused":
            g.run_started_at, g.status = now, "reading"
        self.db.commit()
        return self.out(g)

    def finish(self, *, sitting_id: uuid.UUID, token: str) -> dict:
        g = self._mine(sitting_id, token)
        now = _now()
        self._back(g, now)
        if g.ended_at is None:
            self._close(g, at=now)
        self.db.commit()
        return {**self.out(g), "minutes": int(g.accumulated_seconds) // 60}

    def claim(self, *, sitting_id: uuid.UUID, token: str, user: User) -> dict:
        """The visitor signed up or logged in and keeps the minutes: the sitting becomes theirs, credited into the
        circle's day when they are in the circle (else kept in their reading-room minutes)."""
        g = self._mine(sitting_id, token, lock=True)
        now = _now()
        if g.ended_at is None:
            self._back(g, now)
            if g.ended_at is None:
                self._close(g, at=now)
        if g.claimed_session_id is not None:
            s = self.db.get(ReadingRoomSession, g.claimed_session_id)
            if s is None or s.user_id != user.id:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Already kept")
            return {"minutes": int(s.accumulated_seconds) // 60, "credited": int(s.credited_minutes) > 0, "reason": None}
        rooms = ReadingRoomService(self.db)
        s = ReadingRoomSession(
            user_id=user.id, hall=g.hall, round_id=None, seat=g.seat, book_title=g.book_title, status="ended",
            accumulated_seconds=int(g.accumulated_seconds), run_started_at=None,
            last_seen_at=g.ended_at, ended_at=g.ended_at,
        )
        self.db.add(s)
        self.db.flush()
        s.created_at = g.created_at
        minutes = int(g.accumulated_seconds) // 60
        why = rooms.credit(s, minutes, reading_day(_aware(g.ended_at)))
        g.claimed_session_id = s.id
        self.db.commit()
        return {"minutes": minutes, "credited": int(s.credited_minutes) > 0, "reason": why}
