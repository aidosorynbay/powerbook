"""Which model PowerBook talks to, and how.

DeepSeek when DEEPSEEK_API_KEY is set (the founder's choice on 2026-10-01:
cheap enough to keep every AI feature switched on), Claude when only an
Anthropic key is, nothing otherwise. Both answer in the two shapes the site
needs: a JSON object in a fixed form (the reading letters, the round
review) and a plain reply in a conversation (talking about a book).

DeepSeek is called over its OpenAI-compatible HTTP API with the standard
library, so it adds no package to the image. Its JSON mode guarantees JSON
but not the shape, so the shape is described in the system prompt with an
example, checked on return, and asked once more if it came back wrong.
"""
from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.request

from app.core.config import settings
from app.services import claude
from app.services.claude import AiRefused, AiUnavailable

logger = logging.getLogger(__name__)

__all__ = ["AiRefused", "AiUnavailable", "LETTER_WITHIN", "available", "ask_json", "chat", "model_name", "provider"]

# DeepSeek holds a waiting request open by sending blank lines, for up to half
# an hour when it is busy (api-docs.deepseek.com/quick_start/rate_limit), so the
# socket timeout never fires: one reading letter waited 15 minutes for each of
# its two tries, and both came back empty (Sentry POWERBOOK-BACKEND-3). Past
# these many seconds the answer is given up: a letter's tries together, and
# one reply in a conversation, which the reader waits for on the page.
LETTER_WITHIN = 210
REPLY_WITHIN = 90
# The longest wait for a single piece of the answer.
_SOCKET_TIMEOUT = 120


def provider() -> str | None:
    if settings.deepseek_api_key:
        return "deepseek"
    if claude.available():
        return "claude"
    return None


def available() -> bool:
    return provider() is not None


def model_name() -> str:
    """Part of what a stored letter was written by: a new model writes it anew."""
    return settings.deepseek_model if provider() == "deepseek" else settings.ai_model


# ---------- DeepSeek ----------


def _read_by(response, deadline: float) -> bytes:
    """The body, a piece at a time, so the blank lines of a waiting request
    cannot hold it past the deadline."""
    body = bytearray()
    while chunk := response.read1(65536):
        body += chunk
        if time.monotonic() > deadline:
            raise AiUnavailable("slow")
    return bytes(body)


def _deepseek(
    messages: list[dict], *, json_mode: bool, max_tokens: int, deadline: float, temperature: float | None = None
) -> str:
    left = deadline - time.monotonic()
    if left <= 0:
        raise AiUnavailable("slow")
    body: dict = {
        "model": settings.deepseek_model,
        "messages": messages,
        "max_tokens": max_tokens,
        "stream": False,
        # Thinking first is slower and costs more; these answers do not need it.
        "thinking": {"type": "disabled"},
    }
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    if temperature is not None:
        body["temperature"] = temperature
    request = urllib.request.Request(
        f"{settings.deepseek_base_url.rstrip('/')}/chat/completions",
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={"Authorization": f"Bearer {settings.deepseek_api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=min(_SOCKET_TIMEOUT, left)) as response:
            data = json.loads(_read_by(response, deadline))
    except urllib.error.HTTPError as exc:
        detail = exc.read()[:300].decode("utf-8", "replace")
        if exc.code in (401, 402, 403):
            # 402 is an empty balance: the key works, the account needs topping up.
            logger.error("DeepSeek refused the key (%s): %s", exc.code, detail)
            raise AiUnavailable(f"deepseek {exc.code}") from exc
        if exc.code == 429 or exc.code >= 500:
            raise AiUnavailable(f"deepseek {exc.code}") from exc
        if exc.code == 400 and "risk" in detail.lower():
            raise AiRefused("content") from exc
        logger.error("DeepSeek said %s: %s", exc.code, detail)
        raise
    except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
        raise AiUnavailable("unreachable") from exc

    if data.get("error"):
        # A request that waited too long can end in an error under a 200.
        logger.error("DeepSeek answered with an error: %s", str(data["error"])[:300])
        raise AiUnavailable("deepseek error")
    choice = (data.get("choices") or [{}])[0]
    if choice.get("finish_reason") == "content_filter":
        raise AiRefused("content_filter")
    if json_mode and choice.get("finish_reason") == "length":
        raise ValueError("answer cut short")
    content = ((choice.get("message") or {}).get("content") or "").strip()
    if not content:
        # JSON mode "may occasionally return empty content" (DeepSeek's docs);
        # how it ended says which kind, if it fails again.
        logger.warning("DeepSeek gave an empty answer: finish=%s usage=%s", choice.get("finish_reason"), data.get("usage"))
    return content


def _example(schema: dict):
    """A filled-in sample of a JSON schema, which models follow better than the schema itself."""
    kind = schema.get("type")
    if kind == "object":
        return {k: _example(v) for k, v in (schema.get("properties") or {}).items()}
    if kind == "array":
        return [_example(schema.get("items") or {"type": "string"})]
    if kind in ("integer", "number"):
        return 0
    if kind == "boolean":
        return False
    return "…"


def _conform(value, schema: dict, *, top: bool = False, item: bool = False):
    """The answer in the asked shape: missing lists become empty, stray keys
    go, list items missing what they need are dropped. A top-level text that
    is missing altogether means the answer is not usable."""
    kind = schema.get("type")
    if kind == "object":
        if not isinstance(value, dict):
            raise ValueError("not an object")
        props = schema.get("properties") or {}
        out = {}
        for key, sub in props.items():
            if key in value:
                out[key] = _conform(value[key], sub)
            elif key in (schema.get("required") or []):
                if sub.get("type") == "array":
                    out[key] = []
                elif top or item or sub.get("type") == "object":
                    raise ValueError(f"missing {key}")
                else:
                    out[key] = ""
        return out
    if kind == "array":
        items = schema.get("items") or {}
        if not isinstance(value, list):
            value = [value] if value not in (None, "") else []
        kept = []
        for entry in value:
            try:
                kept.append(_conform(entry, items, item=True))
            except ValueError:
                continue
        return kept
    if kind == "string":
        if value is None:
            return ""
        return value if isinstance(value, str) else str(value)
    return value


def ask_json(*, system: str, prompt: str, schema: dict, effort: str = "medium", max_tokens: int = 8000) -> dict:
    if provider() == "deepseek":
        shaped = (
            f"{system}\n\nAnswer with a single JSON object (json) and nothing else, in exactly this shape: "
            f"{json.dumps(_example(schema), ensure_ascii=False)}\n"
            f"The JSON Schema it must follow: {json.dumps(schema, ensure_ascii=False)}"
        )
        messages = [{"role": "system", "content": shaped}, {"role": "user", "content": prompt}]
        deadline = time.monotonic() + LETTER_WITHIN
        last_error: Exception | None = None
        for _ in range(2):
            text = _deepseek(messages, json_mode=True, max_tokens=max_tokens, deadline=deadline)
            try:
                return _conform(json.loads(text), schema, top=True)
            except (json.JSONDecodeError, ValueError) as exc:
                last_error = exc
        raise ValueError(f"no usable JSON in the answer: {last_error}")
    if provider() == "claude":
        return claude.ask_json(system=system, prompt=prompt, schema=schema, effort=effort, max_tokens=max(max_tokens, 16000))
    raise AiUnavailable("no key")


def chat(*, system: str, messages: list[dict], max_tokens: int = 900) -> str:
    """One reply in a conversation; `messages` alternate user and assistant."""
    if provider() == "deepseek":
        return _deepseek(
            [{"role": "system", "content": system}, *messages],
            json_mode=False,
            max_tokens=max_tokens,
            deadline=time.monotonic() + REPLY_WITHIN,
            temperature=0.7,
        )
    if provider() == "claude":
        return claude.chat(system=system, messages=messages, max_tokens=max_tokens)
    raise AiUnavailable("no key")
