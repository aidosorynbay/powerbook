"""A circle's last day neither counts in a streak nor breaks it."""
from __future__ import annotations

from datetime import date, timedelta

from app.services.streaks import longest_and_current


def days(start: date, end: date, skip=()) -> list[date]:
    out, d = [], start
    while d <= end:
        if d not in skip:
            out.append(d)
        d += timedelta(days=1)
    return out


SEP_LAST = date(2026, 9, 30)
AUG_LAST = date(2026, 8, 31)
NEUTRAL = frozenset({AUG_LAST, SEP_LAST})


def test_a_streak_runs_on_across_circles():
    # 1 Aug .. 10 Oct, read every day; the last days score 0 and so are missing.
    read = days(date(2026, 8, 1), date(2026, 10, 10), skip={AUG_LAST, SEP_LAST})
    longest, current = longest_and_current(read, NEUTRAL, today=date(2026, 10, 10))
    assert longest == len(read) == 69
    assert current == 69


def test_without_neutral_days_it_broke_every_month():
    read = days(date(2026, 8, 1), date(2026, 10, 10), skip={AUG_LAST, SEP_LAST})
    assert longest_and_current(read, today=date(2026, 10, 10))[0] == 30  # 1–30 Aug


def test_a_real_missed_day_still_breaks_it():
    read = days(date(2026, 9, 1), date(2026, 10, 5), skip={date(2026, 9, 15), SEP_LAST})
    assert longest_and_current(read, NEUTRAL, today=date(2026, 10, 5))[0] == 19  # 16–29 Sep and 1–5 Oct


def test_neutral_days_are_not_counted_even_when_read():
    read = days(date(2026, 9, 25), date(2026, 10, 2))  # includes 30 Sep
    assert longest_and_current(read, NEUTRAL, today=date(2026, 10, 2))[0] == 7


def test_the_current_streak_survives_the_last_day_waiting_for_today():
    # Read to 29 Sep; today is 1 Oct, the 30th was the correction day.
    read = days(date(2026, 9, 20), date(2026, 9, 29))
    assert longest_and_current(read, NEUTRAL, today=date(2026, 10, 1))[1] == 10
    # Two ordinary days missed: it is over.
    assert longest_and_current(read, NEUTRAL, today=date(2026, 10, 3))[1] == 0
