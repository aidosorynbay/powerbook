"""«Обсудить с AI»: a conversation about one book.

The reader talks to the AI about a book from their shelf, the shared
library or the open reader. What the model is given: the book (title,
author, year, what the catalogues say it is about), and what the reader
has of it on PowerBook (their mark and review, their notes, how far they
are). It is told not to spoil past where the reader is, unless asked.

Kept per reader per book (book_chats), the last messages only. A reader
may send a set number of messages a day (settings.ai_chat_daily_limit),
which is what keeps the bill predictable.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.constants import ROUND_TZ
from app.models.book_chat import BookChat
from app.models.user import User
from app.services import catalog, llm

MAX_TEXT = 1000
# Kept in the database, and sent to the model with each new message.
KEEP = 40
CONTEXT = 12

_LANG = {"ru": "Russian", "kk": "Kazakh", "en": "English"}

_SYSTEM = """You are the reading companion of PowerBook, a reading community in Kazakhstan, talking with a member about one book.

The book: {book}
What the member has of it here: {mine}

How to talk:
- Answer in {lang}, whatever language the book is in.
- Be a thoughtful friend who has read widely: specific, warm, curious. Short answers by default (a few paragraphs at most); longer only when asked.
- Do not reveal plot points beyond where the member is ({progress}) unless they ask for spoilers; if a question needs them, say so and ask first.
- Never invent quotes, page numbers or facts. If you are not sure the book says something, say that you are not sure.
- When it helps, ask one good question back, or connect the book to the member's own notes and mark.
- If the member asks about something unrelated to books and reading, answer briefly and bring the talk back to the book."""


def _bad(detail: str, code: int = status.HTTP_400_BAD_REQUEST) -> HTTPException:
    return HTTPException(status_code=code, detail=detail)


def _today_start() -> datetime:
    now = datetime.now(ROUND_TZ)
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def _book(db: Session, user: User, *, volume_key: str | None, work_key: str | None) -> dict:
    """The book the talk is about, and the reader's own copy of it if they have one."""
    from app.services import books
    from app.services.bookcase import BookcaseService

    shelf = BookcaseService(db).bookcase(owner_id=user.id, viewer_id=user.id)

    def own(key: str | None):
        if not key:
            return None
        for b in shelf.books:
            # The reader opens a file by its upload id; the file may sit on a finished book's volume.
            if b.key == key or (key.startswith("u:") and b.upload_id and str(b.upload_id) == key[2:]):
                return b
        return None

    idx = catalog.index(db)
    vol = own(volume_key)
    if volume_key and vol is None:
        raise _bad("book_not_on_shelf", status.HTTP_404_NOT_FOUND)
    work = idx.find(work_key) if work_key else None
    if vol is not None and work is None:
        work = idx.find(vol.match_key) or idx.find(catalog.work_key(vol.title) or "")
    if vol is None and work is not None:
        vol = own(work.holders.get(user.id))
    if vol is None and work is None:
        raise _bad("book_not_found", status.HTTP_404_NOT_FOUND)

    key = work.key if work else (vol.match_key or catalog.work_key(vol.title) or vol.key)
    title = work.title if work else vol.title
    author = (work.author if work else None) or (vol.author if vol else None)
    fact = books.facts_by_work(db, idx).get(work.key) if work else None
    about = None
    if fact is not None and fact.about:
        for lang in ("ru", "en", "kk"):
            entry = fact.about.get(lang) if isinstance(fact.about, dict) else None
            if entry and entry.get("text"):
                about = entry["text"][:1200]
                break
    return {"key": key, "title": title, "author": author, "fact": fact, "about": about, "vol": vol}


def _describe(book: dict) -> tuple[str, str, str]:
    fact, vol = book["fact"], book["vol"]
    parts = [f"«{book['title']}»"]
    if book["author"]:
        parts.append(f"by {book['author']}")
    if fact is not None and fact.year:
        parts.append(f"({fact.year})")
    text = " ".join(parts)
    if book["about"]:
        text += f". What the catalogues say it is about: {book['about']}"

    mine: list[str] = []
    progress = "not stated; assume they may not have finished it"
    if vol is not None:
        if vol.status == "finished":
            progress = "they have finished it"
        elif vol.has_file and vol.progress_percent:
            progress = f"about {vol.progress_percent}% through"
        mine.append(f"status: {vol.status}")
        if vol.rating:
            mine.append(f"their mark: {vol.rating}/10")
        if vol.review:
            mine.append(f"their review: {vol.review[:600]}")
        if vol.note:
            mine.append(f"what they wrote on finishing: {vol.note[:400]}")
        notes = [n.text for n in (vol.notes or []) if getattr(n, "text", None)]
        if notes:
            mine.append("their notes: " + " | ".join(t[:300] for t in notes[-8:]))
    return text, ("; ".join(mine) or "nothing yet"), progress


def _out_messages(chat: BookChat | None) -> list[dict]:
    return [{"role": m["role"], "content": m["content"], "at": m.get("at")} for m in (chat.messages if chat else [])]


def _sent_today(db: Session, user_id: uuid.UUID) -> int:
    since = _today_start()
    count = 0
    for (messages,) in db.execute(
        select(BookChat.messages).where(BookChat.user_id == user_id, BookChat.updated_at >= since - timedelta(days=1))
    ).all():
        for m in messages or []:
            if m.get("role") != "user" or not m.get("at"):
                continue
            try:
                at = datetime.fromisoformat(m["at"])
            except ValueError:
                continue
            if at >= since:
                count += 1
    return count


def _chat_row(db: Session, user_id: uuid.UUID, key: str) -> BookChat | None:
    return db.execute(select(BookChat).where(BookChat.user_id == user_id, BookChat.work_key == key)).scalar_one_or_none()


def state(db: Session, *, user: User, volume_key: str | None, work_key: str | None) -> dict:
    book = _book(db, user, volume_key=volume_key, work_key=work_key)
    chat = _chat_row(db, user.id, book["key"])
    left = max(0, settings.ai_chat_daily_limit - _sent_today(db, user.id))
    return {
        "available": llm.available(),
        "work_key": book["key"],
        "title": book["title"],
        "author": book["author"],
        "messages": _out_messages(chat),
        "left_today": left,
    }


def send(db: Session, *, user: User, volume_key: str | None, work_key: str | None, text: str, lang: str) -> dict:
    text = (text or "").strip()
    if not text:
        raise _bad("empty_message")
    if len(text) > MAX_TEXT:
        raise _bad("message_too_long")
    if not llm.available():
        raise _bad("ai_unavailable", status.HTTP_503_SERVICE_UNAVAILABLE)
    if _sent_today(db, user.id) >= settings.ai_chat_daily_limit:
        raise _bad("ai_daily_limit", status.HTTP_429_TOO_MANY_REQUESTS)

    book = _book(db, user, volume_key=volume_key, work_key=work_key)
    chat = _chat_row(db, user.id, book["key"])
    history = list(chat.messages) if chat else []
    described, mine, progress = _describe(book)
    system = _SYSTEM.format(book=described, mine=mine, progress=progress, lang=_LANG.get(lang, "Russian"))
    convo = [{"role": m["role"], "content": m["content"]} for m in history[-CONTEXT:]]
    convo.append({"role": "user", "content": text})
    try:
        answer = llm.chat(system=system, messages=convo)
    except llm.AiUnavailable:
        raise _bad("ai_unavailable", status.HTTP_503_SERVICE_UNAVAILABLE) from None
    except llm.AiRefused:
        raise _bad("ai_refused", status.HTTP_422_UNPROCESSABLE_ENTITY) from None
    if not answer:
        raise _bad("ai_empty", status.HTTP_502_BAD_GATEWAY)

    now = datetime.now(timezone.utc).isoformat()
    history += [{"role": "user", "content": text, "at": now}, {"role": "assistant", "content": answer, "at": now}]
    if chat is None:
        chat = BookChat(user_id=user.id, work_key=book["key"], title=book["title"][:300], messages=[])
        db.add(chat)
    # A new list, so the JSON column sees the change.
    chat.messages = history[-KEEP:]
    chat.title = book["title"][:300]
    chat.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {
        "messages": _out_messages(chat)[-2:],
        "left_today": max(0, settings.ai_chat_daily_limit - _sent_today(db, user.id)),
    }


def clear(db: Session, *, user: User, volume_key: str | None, work_key: str | None) -> None:
    book = _book(db, user, volume_key=volume_key, work_key=work_key)
    chat = _chat_row(db, user.id, book["key"])
    if chat is not None:
        db.delete(chat)
        db.commit()
