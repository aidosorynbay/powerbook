"""Messages to the founder in Telegram, from @PowerbookKZBot, and the
founder's answers by its buttons.

So that what waits for the founder (a reader asking for an archive
nickname) comes to them, instead of them opening /admin to look; and they
settle it right there: «Одобрить» or «Отказать» under the message.

TELEGRAM_ADMIN_CHAT_IDS holds who hears: numeric Telegram chat ids,
comma-separated (a username will not do: the Bot API wants the number).
Each of them must have pressed «Start» in the bot once, or Telegram
refuses to let the bot write first. Empty means nobody hears and nothing
happens. Only these chats' buttons are obeyed.

The buttons reach us by the bot's webhook (/api/telegram/webhook), which
the server sets on start (set_webhook). Telegram signs each call with a
secret made from the bot token, so nobody else can press them for us.

Sent in a background thread: the reader's request never waits for
Telegram, and nothing that goes wrong here reaches them.
"""
from __future__ import annotations

import hashlib
import json
import logging
import threading
import urllib.request
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.claim import UsernameClaim
from app.models.enums import ClaimStatus
from app.models.user import User

logger = logging.getLogger(__name__)

SITE = "https://powerbook.kz"
WEBHOOK_URL = f"{SITE}/api/telegram/webhook"


def chat_ids() -> list[str]:
    return [c.strip() for c in settings.telegram_admin_chat_ids.split(",") if c.strip()]


def webhook_secret() -> str:
    return hashlib.sha256(f"powerbook-admin:{settings.telegram_bot_token}".encode()).hexdigest()[:48]


def _call(method: str, payload: dict) -> dict | None:
    request = urllib.request.Request(
        f"https://api.telegram.org/bot{settings.telegram_bot_token}/{method}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.load(response)
    except Exception:  # Telegram's 429/5xx is theirs and passes; a warning, not an error event
        logger.warning("telegram %s failed", method, exc_info=True)
        return None


def _in_background(fn, *args) -> None:
    threading.Thread(target=fn, args=args, daemon=True).start()


def _later(method: str, payload: dict) -> None:
    _in_background(_call, method, payload)


def tell_admins(text: str, *, buttons: list[list[dict]] | None = None) -> None:
    if not settings.telegram_bot_token:
        return
    for chat_id in chat_ids():
        payload = {"chat_id": chat_id, "text": text, "disable_web_page_preview": True}
        if buttons:
            payload["reply_markup"] = {"inline_keyboard": buttons}
        _later("sendMessage", payload)


def set_webhook() -> None:
    """Point the bot's updates at us, so the buttons work. Only when someone
    is meant to hear, and never over a webhook something else set."""
    if not settings.telegram_bot_token or not chat_ids():
        return
    info = _call("getWebhookInfo", {}) or {}
    current = (info.get("result") or {}).get("url") or ""
    # Already ours: nothing to do. Both server workers start together, and
    # Telegram answers the second setWebhook in a row with 429.
    if current == WEBHOOK_URL:
        return
    if current:
        logger.warning("the bot's webhook points elsewhere (%s); leaving it", current)
        return
    _call("setWebhook", {"url": WEBHOOK_URL, "secret_token": webhook_secret(), "allowed_updates": ["callback_query"]})


# ---------- reader feedback ----------

_MOODS = {"love": "😍 Нравится", "ok": "🙂 Нормально", "meh": "😕 Не очень"}


def feedback_received(*, row, user) -> None:
    """A reader answered «Как вам PowerBook?». The photo itself stays in
    /admin (a link here): a copy in Telegram could not be deleted with the
    reader's account, as the privacy policy promises."""
    who = user.display_name or user.username
    handle = user.telegram_handle
    tg = f", tg @{handle}" if handle and handle != user.username else ""
    lines = ["💬 Отзыв о PowerBook", f"{who} (@{user.username}{tg})"]
    if row.mood:
        lines.append(_MOODS.get(row.mood, row.mood))
    if row.text:
        lines.append(f"«{row.text[:3000]}»")
    if row.photo:
        shown = "можно показывать ✅" if row.photo_consent else "только для команды (без галочки)"
        lines.append(f"📷 Фото — {shown}: {SITE}/admin/reader-feedback/details/{row.id}")
    lines.append(f"Все отзывы: {SITE}/admin/reader-feedback/list")
    tell_admins("\n".join(lines))


# ---------- archive nicknames ----------


def claim_waiting(*, claim_id: str, claimant, ghost, rounds: list[str], note: str | None = None) -> None:
    """A reader asked for an archive nickname: it waits for a yes."""
    who = claimant.display_name or claimant.username
    tg = f", tg @{claimant.telegram_id}" if claimant.telegram_id else ""
    gender = getattr(claimant.gender, "value", claimant.gender)
    it = {"female": "она", "male": "он"}.get(gender, "он(а)")
    lines = [
        "🙋 Заявка на ник из истории",
        f"{who} (@{claimant.username}{tg}) говорит, что это {it}: «{ghost.display_name}» (@{ghost.username})",
    ]
    if rounds:
        lines.append("Круги: " + ", ".join(rounds))
    from app.services.claims import CLASH_NOTE

    if note and note.startswith(CLASH_NOTE):
        # a nickname in a circle the reader already has: renamed mid-month, or not them
        lines.append(f"⚠ В одном круге с историей читателя: {note[len(CLASH_NOTE):].split(' · ')[0]} — сменили ник или чужой?")
    lines.append(f"Все заявки: {SITE}/admin/username-claim/list")
    tell_admins("\n".join(lines), buttons=[[
        {"text": "✅ Одобрить", "callback_data": f"claim:a:{claim_id}"},
        {"text": "❌ Отказать", "callback_data": f"claim:r:{claim_id}"},
    ]])


def claim_by_telegram(*, claimant, nick: str, rounds: int) -> None:
    """A reader proved their old nickname through Telegram and took its
    history at once: nothing to approve, only to know."""
    who = claimant.display_name or claimant.username
    tell_admins(f"✅ Через Telegram: {who} (@{claimant.username}) забрал(а) историю ника @{nick} — кругов: {rounds}")


def _together(db: Session, claim: UsernameClaim) -> list[UsernameClaim]:
    """The request and the ones it brought along: a reader asking for one
    nickname asks for every archive account recorded as the same person."""
    ghost = db.get(User, claim.ghost_user_id)
    if ghost is None or not ghost.person_id:
        return [claim]
    same = select(User.id).where(User.person_id == ghost.person_id)
    rows = db.execute(select(UsernameClaim).where(
        UsernameClaim.claimant_user_id == claim.claimant_user_id,
        UsernameClaim.ghost_user_id.in_(same),
        UsernameClaim.status == ClaimStatus.pending,
    )).scalars().all()
    return list(rows) or [claim]


def decide_claim(db: Session, claim_id: uuid.UUID, approve: bool) -> str:
    """The founder's button. Returns what to write under the message."""
    claim = db.get(UsernameClaim, claim_id)
    if claim is None:
        return "Заявки уже нет"
    if claim.status != ClaimStatus.pending:
        return "Уже одобрено" if claim.status == ClaimStatus.approved else "Заявку уже отменили"
    now = datetime.now(timezone.utc)
    claims = _together(db, claim)
    if approve:
        # One nickname belongs to one person: if it is already someone's,
        # say so instead of quietly granting it twice (as /admin does).
        taken = db.execute(select(UsernameClaim.id).where(
            UsernameClaim.ghost_user_id == claim.ghost_user_id,
            UsernameClaim.status == ClaimStatus.approved,
            UsernameClaim.id != claim.id,
        )).first()
        if taken:
            return "⚠️ Этот ник уже отдан другому читателю — смотрите /admin"
    for row in claims:
        row.status = ClaimStatus.approved if approve else ClaimStatus.revoked
        row.reviewed_at = now
    db.commit()
    return "✅ Одобрено" if approve else "❌ Отказано"


def _on_checkin_button(db: Session, query: dict, data: str) -> None:
    """«✅ Отправить всем» / «❌ <имя>» under the morning list (app/services/checkins.py)."""
    from app.services import checkins

    try:
        verdict, line, buttons = checkins.decide(db, data)
    except Exception:
        logger.exception("check-in button failed")
        db.rollback()
        verdict, line, buttons = "Не получилось — откройте /messages", None, None
    _later("answerCallbackQuery", {"callback_query_id": query.get("id"), "text": verdict})
    message = query.get("message") or {}
    if not line or not message.get("message_id"):
        return
    payload = {
        "chat_id": (message.get("chat") or {}).get("id"),
        "message_id": message["message_id"],
        "text": f"{message.get('text', '')}\n{line}"[-4000:],  # Telegram takes 4096 at most
        "disable_web_page_preview": True,
    }
    if buttons:
        payload["reply_markup"] = {"inline_keyboard": buttons}
    _later("editMessageText", payload)


def on_update(db: Session, update: dict) -> None:
    """One update from Telegram: only a founder's button press means anything."""
    query = update.get("callback_query") or {}
    data = query.get("data") or ""
    sender = str((query.get("from") or {}).get("id") or "")
    if not data.startswith(("claim:", "ci:")):
        return
    if sender not in chat_ids():
        _later("answerCallbackQuery", {"callback_query_id": query.get("id"), "text": "Только для админа"})
        return
    if data.startswith("ci:"):
        _on_checkin_button(db, query, data)
        return
    try:
        _, verb, raw_id = data.split(":", 2)
        verdict = decide_claim(db, uuid.UUID(raw_id), approve=verb == "a")
    except Exception:
        logger.exception("claim button failed")
        db.rollback()
        verdict = "Не получилось — откройте /admin"
    _later("answerCallbackQuery", {"callback_query_id": query.get("id"), "text": verdict})
    message = query.get("message") or {}
    if message.get("message_id"):
        _later("editMessageText", {
            "chat_id": (message.get("chat") or {}).get("id"),
            "message_id": message["message_id"],
            "text": f"{message.get('text', '')}\n\n{verdict}",
            "disable_web_page_preview": True,
        })
