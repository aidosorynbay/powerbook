"""Days in a row, with each circle's last day left out.

A circle's last day is for corrections and never scores (reading_logs.py),
so a run of 30-minute days counted plainly broke at the end of every month:
nobody could reach a 100- or 365-day streak. Here a last day neither counts
nor breaks the run: a reader who read through September and on into October
keeps one streak.
"""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.round import Round


def circle_last_days(db: Session) -> frozenset[date]:
    """Every circle's last (correction) day."""
    return frozenset(r.last_day_date for r in db.execute(select(Round)).scalars())


def _bridged(earlier: date, later: date, neutral: frozenset[date]) -> bool:
    """Whether every day strictly between the two is a neutral one."""
    d = earlier + timedelta(days=1)
    while d < later:
        if d not in neutral:
            return False
        d += timedelta(days=1)
    return True


def longest_and_current(days: list[date], neutral: frozenset[date] = frozenset(), today: date | None = None) -> tuple[int, int]:
    """The longest run of days and the run still going today (or yesterday).

    Neutral days inside the list are not counted; between two days they do
    not break the run.
    """
    ordered = sorted(set(days) - neutral)
    if not ordered:
        return 0, 0
    longest = run = 1
    for prev, d in zip(ordered, ordered[1:]):
        run = run + 1 if _bridged(prev, d, neutral) else 1
        longest = max(longest, run)

    today = today or date.today()
    last = ordered[-1]
    # Still going if nothing but neutral days stands between the last day and today.
    if last >= today - timedelta(days=1) or _bridged(last, today, neutral):
        current = 1
        for i in range(len(ordered) - 1, 0, -1):
            if _bridged(ordered[i - 1], ordered[i], neutral):
                current += 1
            else:
                break
    else:
        current = 0
    return longest, current
