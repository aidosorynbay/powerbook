from __future__ import annotations

from pydantic import BaseModel


class ClaimCandidateOut(BaseModel):
    user_id: str
    username: str
    display_name: str
    rounds: list[str]  # round labels, e.g. "Nov 2025"


class ClaimCreateRequest(BaseModel):
    ghost_user_id: str
    note: str | None = None


class MyClaimOut(BaseModel):
    id: str
    ghost_user_id: str
    ghost_username: str
    ghost_display_name: str
    status: str
    note: str | None
    created_at: str
    rounds: list[str]


class ClaimSuggestionsOut(BaseModel):
    # The account already carries circles from before it was opened.
    has_archive: bool
    # Archive nicknames that look like this reader, best first.
    suggestions: list[ClaimCandidateOut]
