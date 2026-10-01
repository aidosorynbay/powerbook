"""/admin → «Архив: покрытие»: how much of the circles' archive has found its readers.

The founder sees about twenty claims and asks why there are not more. The
answer is in numbers the reader-facing site cannot show: how many accounts
already carry their circles from the import, how many asked for a nickname,
how many have neither, and which archive nicknames still read in 2025–2026
but belong to nobody. Next to each, the likely matches, and a button that
links them on the spot: the founder knows these people.
"""
from __future__ import annotations

import inspect
import time
import uuid
from collections import defaultdict
from datetime import timezone
from urllib.parse import quote

from sqladmin import BaseView, expose
from sqlalchemy import select
from starlette.requests import Request
from starlette.responses import RedirectResponse

from app.core.constants import ROUND_TZ
from app.db.session import get_session_factory
from app.models.claim import UsernameClaim
from app.models.enums import ClaimStatus
from app.models.round import Round, RoundParticipant
from app.models.user import User
from app.services import claim_match
from app.services.claims import ClaimsService

# Archive nicknames that read this recently are most likely people still around.
RECENT_YEAR = 2025
_ROWS = 80
_TTL_SECONDS = 120
_cache: dict[str, object] = {"at": 0.0, "data": None}


def _astana(value) -> str:
    if value is None:
        return ""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(ROUND_TZ).strftime("%d.%m.%Y %H:%M")


def _span(months: list[tuple[int, int]]) -> str:
    if not months:
        return ""
    years = sorted({y for y, _m in months})
    return str(years[0]) if years[0] == years[-1] else f"{years[0]}–{years[-1]}"


def build(db) -> dict:
    users = db.execute(
        select(User.id, User.username, User.display_name, User.telegram_id, User.created_at).where(
            User.is_claimable.is_(False), User.is_active.is_(True)
        )
    ).all()
    months: dict[uuid.UUID, list[tuple[int, int]]] = defaultdict(list)
    for user_id, year, month in db.execute(
        select(RoundParticipant.user_id, Round.year, Round.month).join(Round, Round.id == RoundParticipant.round_id)
    ).all():
        months[user_id].append((year, month))

    claims = db.execute(
        select(UsernameClaim.id, UsernameClaim.claimant_user_id, UsernameClaim.ghost_user_id, UsernameClaim.status, UsernameClaim.created_at)
    ).all()
    approved_by: dict[uuid.UUID, set[uuid.UUID]] = defaultdict(set)
    pending_by: dict[uuid.UUID, set[uuid.UUID]] = defaultdict(set)
    granted: set[uuid.UUID] = set()
    asked: set[uuid.UUID] = set()
    for _cid, claimant, ghost, status, _at in claims:
        if status == ClaimStatus.approved:
            approved_by[claimant].add(ghost)
            granted.add(ghost)
        elif status == ClaimStatus.pending:
            pending_by[claimant].add(ghost)
            asked.add(ghost)

    def own_archive(user) -> bool:
        if user.created_at is None:
            return False
        opened = user.created_at.year * 12 + user.created_at.month
        return any(y * 12 + m < opened for y, m in months.get(user.id, []))

    def reads_here(user) -> bool:
        if user.created_at is None:
            return bool(months.get(user.id))
        opened = user.created_at.year * 12 + user.created_at.month
        return any(y * 12 + m >= opened for y, m in months.get(user.id, []))

    with_archive = [u for u in users if own_archive(u)]
    with_approved = [u for u in users if approved_by.get(u.id)]
    with_pending = [u for u in users if pending_by.get(u.id) and not approved_by.get(u.id)]
    neither = [u for u in users if not own_archive(u) and not approved_by.get(u.id) and not pending_by.get(u.id)]
    neither_reading = [u for u in neither if reads_here(u)]

    ghosts = claim_match.claimable_ghosts(db)
    free = [g for g in ghosts if g.id not in granted]
    recent_free = [g for g in free if any(y >= RECENT_YEAR for y, _m in months.get(g.id, []))]

    user_keys = {u.id: claim_match.keys(u.username, u.display_name, u.telegram_id) for u in users}
    ghost_by_id = {g.id: g for g in ghosts}
    user_by_id = {u.id: u for u in users}

    def matches_for_user(user, limit=3):
        mine = user_keys[user.id]
        scored = []
        for g in free:
            sc = claim_match.score(mine, g.keys)
            if sc >= claim_match.THRESHOLD and months.get(g.id):
                scored.append((sc, g))
        scored.sort(key=lambda x: (-x[0], x[1].username.casefold()))
        return [
            {"ghost_id": str(g.id), "username": g.username, "display_name": g.display_name,
             "circles": len(months[g.id]), "span": _span(months[g.id]), "score": int(sc * 100)}
            for sc, g in scored[:limit]
        ]

    candidates_for_ghost = [u for u in users if not approved_by.get(u.id)]

    def matches_for_ghost(ghost, limit=3):
        scored = []
        for u in candidates_for_ghost:
            sc = claim_match.score(user_keys[u.id], ghost.keys)
            if sc >= claim_match.THRESHOLD:
                scored.append((sc, u))
        scored.sort(key=lambda x: (-x[0], x[1].username.casefold()))
        return [
            {"user_id": str(u.id), "username": u.username, "display_name": u.display_name,
             "telegram": u.telegram_id or "", "score": int(sc * 100)}
            for sc, u in scored[:limit]
        ]

    neither_sorted = sorted(neither, key=lambda u: (not reads_here(u), -(u.created_at.timestamp() if u.created_at else 0)))
    readers = [
        {
            "user_id": str(u.id), "username": u.username, "display_name": u.display_name,
            "telegram": u.telegram_id or "", "joined": _astana(u.created_at), "reads_here": reads_here(u),
            "matches": matches_for_user(u),
        }
        for u in neither_sorted[:_ROWS]
    ]

    def last_month(g) -> tuple[int, int]:
        return max(months.get(g.id, [(0, 0)]))

    nicknames = [
        {
            "ghost_id": str(g.id), "username": g.username, "display_name": g.display_name,
            "circles": len(months.get(g.id, [])), "last": "%02d.%d" % (last_month(g)[1], last_month(g)[0]),
            "asked": g.id in asked, "matches": matches_for_ghost(g),
        }
        for g in sorted(recent_free, key=lambda g: last_month(g), reverse=True)[:_ROWS]
    ]

    pending = []
    for cid, claimant, ghost_id, status, at in sorted(claims, key=lambda c: c[4].timestamp() if c[4] else 0, reverse=True):
        if status != ClaimStatus.pending:
            continue
        u = user_by_id.get(claimant)
        g = ghost_by_id.get(ghost_id)
        pending.append({
            "claim_id": str(cid),
            "claimant": u.username if u else "?", "claimant_name": u.display_name if u else "",
            "ghost": g.username if g else "?", "ghost_name": g.display_name if g else "",
            "circles": len(months.get(ghost_id, [])), "span": _span(months.get(ghost_id, [])), "at": _astana(at),
        })

    return {
        "counts": {
            "real": len(users),
            "with_archive": len(with_archive),
            "with_approved": len(with_approved),
            "with_pending": len(with_pending),
            "neither": len(neither),
            "neither_reading": len(neither_reading),
            "ghosts": len(ghosts),
            "ghosts_granted": len(granted),
            "ghosts_asked": len(asked - granted),
            "ghosts_free": len(free),
            "ghosts_recent_free": len(recent_free),
            "claims_total": len(claims),
            "claims_pending": len(pending),
        },
        "pending": pending,
        "readers": readers,
        "nicknames": nicknames,
        "recent_year": RECENT_YEAR,
    }


class ArchiveCoverageView(BaseView):
    name = "Архив: покрытие"
    identity = "archive-coverage"
    icon = "fa-solid fa-user-clock"

    @expose("/archive-coverage", methods=["GET"])
    async def page(self, request: Request):
        fresh = request.query_params.get("fresh") == "1"
        data = _cache.get("data")
        if fresh or data is None or time.monotonic() - float(_cache["at"]) > _TTL_SECONDS:
            db = get_session_factory()()
            try:
                data = build(db)
            finally:
                db.close()
            _cache["data"], _cache["at"] = data, time.monotonic()
        base = str(request.url_for("admin:index")).rstrip("/")
        context = {
            "title": "Архив: покрытие",
            "subtitle": "Сколько архива кругов уже нашло своих читателей",
            "data": data,
            "base": base,
            "msg": request.query_params.get("msg", ""),
            "error": request.query_params.get("error", ""),
        }
        response = self.templates.TemplateResponse(request, "archive_coverage.html", context)
        if inspect.isawaitable(response):
            response = await response
        return response

    @expose("/archive-coverage/link", methods=["POST"])
    async def link(self, request: Request):
        form = await request.form()
        base = str(request.url_for("admin:index")).rstrip("/")
        db = get_session_factory()()
        try:
            user_id = uuid.UUID(str(form.get("user_id")))
            ghost_id = uuid.UUID(str(form.get("ghost_id")))
            admin = request.session.get("admin_user")
            ClaimsService(db).link_by_admin(
                user_id=user_id, ghost_user_id=ghost_id, admin_id=uuid.UUID(admin) if admin else None
            )
            user = db.get(User, user_id)
            ghost = db.get(User, ghost_id)
            msg = f"Привязано: @{ghost.username if ghost else '?'} → @{user.username if user else '?'}"
            target = f"{base}/archive-coverage?fresh=1&msg={quote(msg)}"
        except Exception as exc:  # the service says why (already granted, shares a circle)
            detail = getattr(exc, "detail", None) or str(exc)
            target = f"{base}/archive-coverage?error={quote(str(detail)[:200])}"
        finally:
            db.close()
        claim_match.invalidate()
        _cache["data"] = None
        return RedirectResponse(target, status_code=303)

    @expose("/archive-coverage/approve", methods=["POST"])
    async def approve(self, request: Request):
        from datetime import datetime

        form = await request.form()
        base = str(request.url_for("admin:index")).rstrip("/")
        db = get_session_factory()()
        try:
            claim = db.get(UsernameClaim, uuid.UUID(str(form.get("claim_id"))))
            if claim is None or claim.status != ClaimStatus.pending:
                target = f"{base}/archive-coverage?error={quote('Заявка уже не ждёт решения')}"
            else:
                taken = db.execute(
                    select(UsernameClaim).where(
                        UsernameClaim.ghost_user_id == claim.ghost_user_id,
                        UsernameClaim.status == ClaimStatus.approved,
                        UsernameClaim.id != claim.id,
                    )
                ).scalar_one_or_none()
                if taken is not None:
                    target = f"{base}/archive-coverage?error={quote('Этот ник уже отдан другому читателю')}"
                else:
                    admin = request.session.get("admin_user")
                    claim.status = ClaimStatus.approved
                    claim.reviewed_by_user_id = uuid.UUID(admin) if admin else None
                    claim.reviewed_at = datetime.now(timezone.utc)
                    db.commit()
                    target = f"{base}/archive-coverage?fresh=1&msg={quote('Заявка одобрена')}"
        finally:
            db.close()
        _cache["data"] = None
        return RedirectResponse(target, status_code=303)
