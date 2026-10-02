"""add reading_room_sessions.away_seconds

A phone stops the reading room's page while its screen is off, and the room cannot tell a reader with a paper book
from one who has left. The time a sitting's page was silent is held here until the reader, back at the page, says
whether they read through it.

One column with a default, so this is safe to apply to live data.

Revision ID: a7b8c9d0e1f2
Revises: z6a7b8c9d0e1
Create Date: 2026-10-02

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "a7b8c9d0e1f2"
down_revision = "z6a7b8c9d0e1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "reading_room_sessions",
        sa.Column("away_seconds", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("reading_room_sessions", "away_seconds")
