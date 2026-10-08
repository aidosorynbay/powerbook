from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel

# "sticker": the story sticker, copied or saved; "story": the whole story picture.
Channel = Literal["whatsapp", "telegram", "x", "copy", "native", "sticker", "story"]


Template = Literal["page", "shelf", "calendar", "shelfCalendar"]
StickerAction = Literal["copy", "save", "download", "share"]
Ink = Literal["light", "dark"]


class ShareDayIn(BaseModel):
    round_id: str
    day: date
    channel: Channel
    # For a sticker or the whole story picture: which one, what was done with it, in which ink.
    template: Template | None = None
    action: StickerAction | None = None
    ink: Ink | None = None


class CardDayOut(BaseModel):
    date: date
    minutes: int
    # 1 once the day reached the daily 30 minutes.
    score: int


class DayCardOut(BaseModel):
    """A reader's round as a shared day shows it: minutes only, never what was
    read or written about it."""

    username: str
    display_name: str
    avatar_data: str | None
    year: int
    month: int
    first_day: date
    last_day: date
    # The day the card is about, and its number within the round.
    day: date
    day_number: int
    minutes: int
    streak: int
    goal_days: int
    total_minutes: int
    # Every day of the round's window; days after `day` are still ahead.
    days: list[CardDayOut]


class MyDayCardOut(DayCardOut):
    round_id: str
    # Readers who signed up from this reader's links.
    invited: int
    # The book the reader is on, for their own story sticker. The public card
    # never has it.
    book: str | None = None
    # The round's days the reader finished a book on, for the day picker and
    # the sticker. Own card only, like the book.
    finished_days: list[date] = []
