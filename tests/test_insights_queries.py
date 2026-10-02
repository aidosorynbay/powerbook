"""The reader's all-time profile and year read their circles in one query:
one query per circle was an N+1 on /api/insights/badges (Sentry
POWERBOOK-BACKEND-2)."""
from __future__ import annotations

import calendar
from datetime import date

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.base import Base
from app.models.enums import Gender, RoundParticipantStatus, RoundStatus
from app.models.group import Group
from app.models.round import ReadingLog, Round, RoundParticipant
from app.models.user import User
from app.services.insights import InsightsService

MONTHS = [(2025, 11), (2025, 12), (2026, 1), (2026, 2), (2026, 3)]


def test_circles_are_read_in_one_query_not_one_each():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    setup = Session()
    me = User(username="madik", display_name="Madik", password_hash="x", gender=Gender.male)
    setup.add(me)
    setup.flush()
    group = Group(name="PowerBook", slug="powerbook", owner_user_id=me.id)
    setup.add(group)
    setup.flush()
    for year, month in MONTHS:
        rnd = Round(group_id=group.id, year=year, month=month, status=RoundStatus.closed, end_day=None)
        setup.add(rnd)
        setup.flush()
        setup.add(RoundParticipant(round_id=rnd.id, user_id=me.id, status=RoundParticipantStatus.active))
        setup.add(ReadingLog(round_id=rnd.id, user_id=me.id, date=date(year, month, 1), minutes=40, score=1))
    setup.commit()
    my_id = me.id
    setup.close()

    one_round_each = []

    @event.listens_for(engine, "before_cursor_execute")
    def _count(conn, cursor, statement, *args):
        if "FROM rounds" in statement and "WHERE rounds.id = " in statement:
            one_round_each.append(statement)

    service = InsightsService(Session())
    profile = service.all_time_profile(user_id=my_id)
    possible = sum(calendar.monthrange(y, m)[1] for y, m in MONTHS)
    assert profile.rounds_participated == 5
    assert profile.consistency_percent == round(5 / possible * 100)

    year = service.wrapped(user_id=my_id, year=2026)
    assert year.rounds_participated == 3

    assert one_round_each == []
