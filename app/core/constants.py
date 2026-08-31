"""
Application constants.
Central place for magic strings and configuration values.
"""
from __future__ import annotations
from zoneinfo import ZoneInfo

# Default group slug for single-group MVP
# All group-related endpoints use this when no specific group is provided
DEFAULT_GROUP_SLUG = "powerbook"

# Round settings
DEFAULT_LEAVE_DEADLINE_DAY = 10  # Users can leave a round until this day of the month

# Cache keys
CACHE_KEY_PUBLIC_STATS = "public_stats"

# The circle's final day is for corrections only, and they close at this hour
# local time. Read by the service that enforces it and by the one that reports
# it to the client, because a countdown that outlives the cut-off is worse
# than no countdown.
CORRECTION_DEADLINE_HOUR = 20
CORRECTION_TZ = ZoneInfo("Asia/Almaty")  # GMT+5
