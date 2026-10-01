"""The one place PowerBook talks to Claude.

Every call asks for JSON in a fixed shape (structured outputs), so what
comes back can be stored and rendered without guessing. A request Claude's
safety classifiers decline is re-run server-side on the model Anthropic
recommends for that case (fallbacks "default"); one still declined after
that raises AiRefused.
"""
from __future__ import annotations

import json
import logging

from app.core.config import settings

logger = logging.getLogger(__name__)

_FALLBACK_BETA = "server-side-fallback-2026-07-01"
# Web search can pause a long turn; each resume continues where it stopped.
_MAX_RESUMES = 4


class AiUnavailable(Exception):
    """No key, or the API is out of reach: the feature waits, nothing is wrong with the input."""


class AiRefused(Exception):
    pass


def available() -> bool:
    return bool(settings.anthropic_api_key)


def _client():
    import anthropic

    if not available():
        raise AiUnavailable("no key")
    return anthropic.Anthropic(api_key=settings.anthropic_api_key, timeout=300.0, max_retries=2)


def ask_json(
    *,
    system: str,
    prompt: str,
    schema: dict,
    web_search: bool = False,
    effort: str = "medium",
    max_tokens: int = 16000,
) -> dict:
    import anthropic

    client = _client()
    messages: list[dict] = [{"role": "user", "content": prompt}]
    kwargs: dict = {
        "model": settings.ai_model,
        "max_tokens": max_tokens,
        "system": system,
        "output_config": {"effort": effort, "format": {"type": "json_schema", "schema": schema}},
        "betas": [_FALLBACK_BETA],
        "fallbacks": "default",
    }
    if web_search:
        kwargs["tools"] = [{"type": "web_search_20260209", "name": "web_search", "max_uses": 5}]

    try:
        response = client.beta.messages.create(messages=messages, **kwargs)
        for _ in range(_MAX_RESUMES):
            if response.stop_reason != "pause_turn":
                break
            messages = [*messages, {"role": "assistant", "content": response.content}]
            response = client.beta.messages.create(messages=messages, **kwargs)
    except (anthropic.AuthenticationError, anthropic.PermissionDeniedError) as exc:
        logger.error("Claude refused the key: %s", exc)
        raise AiUnavailable("key rejected") from exc
    except anthropic.RateLimitError as exc:
        raise AiUnavailable("rate limited") from exc
    except anthropic.APIConnectionError as exc:
        raise AiUnavailable("unreachable") from exc
    except anthropic.APIStatusError as exc:
        if exc.status_code >= 500:
            raise AiUnavailable(f"server error {exc.status_code}") from exc
        raise

    if response.stop_reason == "refusal":
        category = getattr(response.stop_details, "category", None) if response.stop_details else None
        raise AiRefused(str(category or "refused"))
    if response.stop_reason == "max_tokens":
        raise ValueError("answer cut short")

    # With tools in play there may be words between the searches; the answer
    # in the requested shape is the last text block.
    texts = [block.text for block in response.content if block.type == "text" and block.text.strip()]
    for text in reversed(texts):
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            continue
    raise ValueError("no JSON in the answer")


def chat(*, system: str, messages: list[dict], max_tokens: int = 900) -> str:
    """One plain reply in a conversation (talking about a book)."""
    import anthropic

    client = _client()
    try:
        response = client.messages.create(model=settings.ai_model, max_tokens=max_tokens, system=system, messages=messages)
    except (anthropic.AuthenticationError, anthropic.PermissionDeniedError) as exc:
        raise AiUnavailable("key rejected") from exc
    except (anthropic.RateLimitError, anthropic.APIConnectionError) as exc:
        raise AiUnavailable("unreachable") from exc
    except anthropic.APIStatusError as exc:
        if exc.status_code >= 500:
            raise AiUnavailable(f"server error {exc.status_code}") from exc
        raise
    if response.stop_reason == "refusal":
        raise AiRefused("refused")
    return "".join(block.text for block in response.content if block.type == "text").strip()
