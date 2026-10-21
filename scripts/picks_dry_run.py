#!/usr/bin/env python3
"""
«Что почитать дальше» on real readers, before anyone sees it (council 2026-10-21).

Writes no picks and rings no bell (covers of books from the world it finds are kept, as any cover lookup does).
For every reader who read in the last 90 days it says whether they would get picks at all (marks, books read,
favourites, club candidates), and with --ask N it asks the AI for the first N of them and prints their picks with
the «why», to read the way a reader would.

Usage (on the server):
    docker compose -f docker-compose.prod.yml exec backend python scripts/picks_dry_run.py
    docker compose -f docker-compose.prod.yml exec backend python scripts/picks_dry_run.py --ask 10 --user madiyar
"""
from __future__ import annotations

import argparse
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import select

from app.db.session import get_session_factory
from app.models.round import ReadingLog
from app.models.user import User
from app.services import librarian, llm


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ask", type=int, default=0, help="ask the AI for this many readers (costs a few cents)")
    parser.add_argument("--user", action="append", default=[], help="these usernames first")
    parser.add_argument("--lang", default="ru")
    args = parser.parse_args()

    db = get_session_factory()()
    since = date.today() - timedelta(days=90)
    active = set(db.execute(select(ReadingLog.user_id).where(ReadingLog.date >= since)).scalars())
    users = [u for u in db.execute(select(User).where(User.id.in_(active))).scalars()]
    users.sort(key=lambda u: (u.username not in args.user, u.username))

    ready = asked = 0
    print(f"# Picks dry run — {len(users)} readers active since {since}\n")
    print("| reader | marks | read, unmarked | favourites | club candidates | picks? |")
    print("|---|---|---|---|---|---|")
    rows = []
    for user in users:
        reader = librarian._Reader(db, user)
        payload, ids = librarian._prepare(db, user, reader, args.lang)
        ok = reader.has_taste()
        ready += ok
        print(f"| {user.username} | {len(reader.marks)} | {len(reader.recent)} | {len(reader.favourites)} | {len(ids)} | {'yes' if ok else 'no'} |")
        rows.append((user, reader, payload, ids, ok))
    print(f"\n**{ready} of {len(users)}** would get picks today.\n")

    if args.ask and not llm.available():
        print("AI is off on this server (no DEEPSEEK_API_KEY / ANTHROPIC_API_KEY).")
        return
    for user, reader, payload, ids, ok in rows:
        if asked >= args.ask or not ok:
            continue
        asked += 1
        print(f"## {user.display_name} (@{user.username})\n")
        loved = [f"«{r.title}» {r.rating}" for _, r in reader.marks[:8]]
        print("Marks: " + ", ".join(loved) + "\n")
        print("First candidates: " + ", ".join(f"«{c['title']}»" + (f" (♥ {c['loved_by'][0]['name']})" if c["loved_by"] else "") for c in payload["candidates"][:10]) + "\n")
        try:
            out = librarian.choose(payload, ids, args.lang)
        except Exception as exc:  # noqa: BLE001
            print(f"Failed: {exc}\n")
            continue
        print(f"_{out['taste']}_\n")
        for p in out["picks"]:
            if p.get("outside"):
                o = p["outside"]
                print(f"- 🌍 **{o['title']}**{', ' + o['author'] if o.get('author') else ''} — {p['why']}  ({o.get('link') or o['source']})")
            else:
                work = reader.idx.works[p["key"]]
                print(f"- **{work.title}**{', ' + work.author if work.author else ''} — {p['why']}")
        if out["dropped"]:
            print(f"\n({out['dropped']} picks dropped: unknown id or a «why» quoting a book the reader never had)")
        print()
    db.close()


if __name__ == "__main__":
    main()
