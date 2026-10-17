"""«Чат команды»: only the team sees it, consent before the first word, the bot speaks in numbers."""
from __future__ import annotations

from datetime import date, datetime

from app.core.constants import ROUND_TZ
from app.models.clan_war import ClanWarMessage
from app.models.round import ReadingLog
from app.services import admin_ping, clan_war, clan_war_chat

from tests.test_clan_war import env, h  # noqa: F401


def _split(c, admin, readers, monkeypatch):
    monkeypatch.setattr(clan_war, "_today", lambda: date(2026, 10, 17))
    for u in readers:
        c.post("/api/war/join", headers=h(u))
    c.post("/api/war/split", headers=h(admin))
    body = c.get("/api/war").json()
    names = {t["key"]: [m["display_name"] for m in t["members"]] for t in body["teams"]}
    return names


def test_only_the_team_sees_its_room_and_writing_needs_consent(env, monkeypatch):
    db, c, admin, readers, rnd = env
    names = _split(c, admin, readers, monkeypatch)
    by_name = {u.display_name: u for u in readers}
    a = by_name[names["lighthouse"][0]]
    a2 = by_name[names["lighthouse"][1]]
    b = by_name[names["sail"][0]]
    assert c.post("/api/war/chat", json={"text": "привет"}, headers=h(a)).status_code == 403  # no consent yet
    assert c.post("/api/war/chat/consent", json={"age_16": True, "agree": False}, headers=h(a)).status_code == 422
    room = c.post("/api/war/chat/consent", json={"age_16": True, "agree": True}, headers=h(a)).json()
    assert room["consented"] is True and room["team"] == "lighthouse"
    room = c.post("/api/war/chat", json={"text": "  Ура, мы Маяк!  "}, headers=h(a)).json()
    mine = [m for m in room["messages"] if m["kind"] == "user"]
    assert mine[-1]["text"] == "Ура, мы Маяк!" and mine[-1]["mine"] is True
    assert c.post("/api/war/chat", json={"text": "ещё"}, headers=h(a)).status_code == 429  # two seconds apart
    # a teammate sees it; the other team does not
    assert any(m["text"] == "Ура, мы Маяк!" for m in c.get("/api/war/chat", headers=h(a2)).json()["messages"])
    assert not any(m["text"] == "Ура, мы Маяк!" for m in c.get("/api/war/chat", headers=h(b)).json()["messages"])
    # someone outside the war has no room
    assert c.get("/api/war/chat", headers=h(admin)).status_code == 403


def test_report_tells_the_founder_without_the_text_and_delete_hides_it(env, monkeypatch):
    db, c, admin, readers, rnd = env
    names = _split(c, admin, readers, monkeypatch)
    by_name = {u.display_name: u for u in readers}
    a, a2 = by_name[names["lighthouse"][0]], by_name[names["lighthouse"][1]]
    c.post("/api/war/chat/consent", json={"age_16": True, "agree": True}, headers=h(a))
    msg = c.post("/api/war/chat", json={"text": "секретный текст"}, headers=h(a)).json()["messages"][-1]
    heard = []
    monkeypatch.setattr(admin_ping, "tell_admins", lambda text, **_: heard.append(text))
    assert c.post(f"/api/war/chat/{msg['id']}/report", json={"reason": "грубо"}, headers=h(a2)).json() == {"ok": True}
    assert heard and "секретный" not in heard[0]
    assert c.post(f"/api/war/chat/{msg['id']}/delete", headers=h(a2)).status_code == 403  # not theirs
    room = c.post(f"/api/war/chat/{msg['id']}/delete", headers=h(a)).json()
    assert not any(m["id"] == msg["id"] for m in room["messages"])


def test_the_bot_speaks_once_in_numbers(env, monkeypatch):
    db, c, admin, readers, rnd = env
    _split(c, admin, readers, monkeypatch)
    war = clan_war.current_war(db)
    db.add(ReadingLog(round_id=rnd.id, user_id=readers[0].id, date=date(2026, 10, 17), minutes=40, score=1,
                      created_at=datetime(2026, 10, 17, 10, 0, tzinfo=ROUND_TZ)))
    db.commit()
    evening = datetime(2026, 10, 17, 21, 5, tzinfo=ROUND_TZ)
    monkeypatch.setattr(clan_war, "_now", lambda: evening)
    clan_war_chat.bot_tick(db, war, evening)
    clan_war_chat.bot_tick(db, war, evening)  # the second worker: nothing new
    codes = sorted((m.team, m.code) for m in db.query(ClanWarMessage).all())
    assert codes.count((0, "start")) == 1 and codes.count((1, "start")) == 1
    eve = [m for m in db.query(ClanWarMessage).filter_by(code="evening").all()]
    assert all(set(m.params) == {"hits", "size"} for m in eve)  # numbers, never names
    # midnight: the 17th locks and each team hears its close
    monkeypatch.setattr(clan_war, "_today", lambda: date(2026, 10, 18))
    clan_war.lock_days(db, war, date(2026, 10, 18))
    clan_war_chat.bot_tick(db, war, datetime(2026, 10, 18, 0, 1, tzinfo=ROUND_TZ))
    days = db.query(ClanWarMessage).filter_by(code="day").all()
    assert len(days) == 2 and {m.params["n"] for m in days} == {1}
    assert sum(m.params["hits"] for m in days) == 1
