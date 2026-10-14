"""guest_room_sittings: reading in the library hall without an account

The founder (2026-10-14): from the front page anyone can start reading in the
reading room right away, and keep the minutes by signing up afterwards.

Revision ID: gr20261014a1
Revises: pr20261013b2
Create Date: 2026-10-14

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "gr20261014a1"
down_revision = "pr20261013b2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "guest_room_sittings",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("hall", sa.String(length=16), nullable=False),
        sa.Column("seat", sa.SmallInteger(), nullable=False),
        sa.Column("book_title", sa.String(length=200), nullable=False),
        sa.Column("gender", sa.String(length=8), nullable=False, server_default="unknown"),
        sa.Column("status", sa.String(length=12), nullable=False, server_default="reading"),
        sa.Column("accumulated_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("run_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("away_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("claimed_session_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_guest_room_sittings_token_hash", "guest_room_sittings", ["token_hash"])
    op.create_index("ix_guest_room_sittings_open", "guest_room_sittings", ["hall", "ended_at"])


def downgrade() -> None:
    op.drop_index("ix_guest_room_sittings_open", table_name="guest_room_sittings")
    op.drop_index("ix_guest_room_sittings_token_hash", table_name="guest_room_sittings")
    op.drop_table("guest_room_sittings")
