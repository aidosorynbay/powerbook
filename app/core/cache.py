"""
Simple in-memory cache with TTL support.

For MVP this is sufficient. For production with multiple workers,
consider Redis or similar.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from threading import Lock
from typing import Generic, TypeVar

T = TypeVar("T")


@dataclass
class CacheEntry(Generic[T]):
    value: T
    expires_at: float


class TTLCache(Generic[T]):
    """Thread-safe in-memory cache with TTL."""

    def __init__(self, ttl_seconds: int = 60):
        self._ttl = ttl_seconds
        self._cache: dict[str, CacheEntry[T]] = {}
        self._lock = Lock()

    def get(self, key: str) -> T | None:
        """Get value if exists and not expired."""
        with self._lock:
            entry = self._cache.get(key)
            if entry is None:
                return None
            if time.time() > entry.expires_at:
                del self._cache[key]
                return None
            return entry.value

    def set(self, key: str, value: T) -> None:
        """Set value with TTL."""
        with self._lock:
            self._cache[key] = CacheEntry(
                value=value,
                expires_at=time.time() + self._ttl,
            )

    def invalidate(self, key: str) -> None:
        """Remove key from cache."""
        with self._lock:
            self._cache.pop(key, None)

    def clear(self) -> None:
        """Clear all cache entries."""
        with self._lock:
            self._cache.clear()


# Global cache instances
# Stats cache - refresh every 30 seconds
stats_cache: TTLCache[dict] = TTLCache(ttl_seconds=30)
