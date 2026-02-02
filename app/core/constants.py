"""
Application constants.
Central place for magic strings and configuration values.
"""
from __future__ import annotations

# Default group slug for single-group MVP
# All group-related endpoints use this when no specific group is provided
DEFAULT_GROUP_SLUG = "powerbook"

# Round settings
DEFAULT_LEAVE_DEADLINE_DAY = 10  # Users can leave a round until this day of the month

# Cache keys
CACHE_KEY_PUBLIC_STATS = "public_stats"
