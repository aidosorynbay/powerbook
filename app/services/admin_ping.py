"""Messages to the founder in Telegram, from @PowerbookKZBot.

So that what waits for the founder (a reader asking for an archive
nickname) comes to them, instead of them opening /admin to look.

TELEGRAM_ADMIN_CHAT_IDS holds who hears: numeric Telegram chat ids,
comma-separated (a username will not do: the Bot API wants the number).
Each of them must have pressed «Start» in the bot once, or Telegram
refuses to let the bot write first. Empty means nobody hears and nothing
happens.

Sent in a background thread: the reader's request never waits for
Telegram, and nothing that goes wrong here reaches them.
"""
from __future__ import annotations

import json
import logging
import threading
import urllib.request

from app.core.config import settings

logger = logging.getLogger(__name__)

SITE = "https://powerbook.kz"


def _chat_ids() -> list[str]:
    return [c.strip() for c in settings.telegram_admin_chat_ids.split(",") if c.strip()]


def _send(chat_id: str, text: str) -> None:
    body = json.dumps({"chat_id": chat_id, "text": text, "disable_web_page_preview": True}).encode()
    request = urllib.request.Request(
        f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=10):
            pass
    except Exception:
        logger.exception("telegram message to the admin failed")


def tell_admins(text: str) -> None:
    if not settings.telegram_bot_token:
        return
    for chat_id in _chat_ids():
        threading.Thread(target=_send, args=(chat_id, text), daemon=True).start()


def claim_waiting(*, claimant, ghost, rounds: list[str]) -> None:
    """A reader asked for an archive nickname: it waits in /admin for a yes."""
    who = claimant.display_name or claimant.username
    tg = f", tg @{claimant.telegram_id}" if claimant.telegram_id else ""
    lines = [
        "🙋 Заявка на ник из истории",
        f"{who} (@{claimant.username}{tg}) говорит, что это он(а): «{ghost.display_name}» (@{ghost.username})",
    ]
    if rounds:
        lines.append("Круги: " + ", ".join(rounds))
    lines.append(f"Одобрить: {SITE}/admin/username-claim/list")
    tell_admins("\n".join(lines))
