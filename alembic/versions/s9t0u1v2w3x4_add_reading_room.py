"""add reading_room_sessions and reading_room_messages

The reading room: who sits in which chair with which book, for how long, and the hall's chat.

New tables and nothing else, so this is safe to apply to live data.

Revision ID: s9t0u1v2w3x4
Revises: r8s9t0u1v2w3
Create Date: 2026-09-29

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "s9t0u1v2w3x4"
down_revision = "r8s9t0u1v2w3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "reading_room_sessions",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("hall", sa.String(length=16), nullable=False),
        sa.Column("round_id", sa.Uuid(as_uuid=True), sa.ForeignKey("rounds.id", ondelete="CASCADE"), nullable=True),
        sa.Column("seat", sa.SmallInteger(), nullable=False),
        sa.Column("book_title", sa.String(length=200), nullable=False),
        sa.Column("status", sa.String(length=12), nullable=False),
        sa.Column("accumulated_seconds", sa.Integer(), nullable=False),
        sa.Column("run_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("credited_minutes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("credited_round_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("credited_date", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_reading_room_sessions_user_id", "reading_room_sessions", ["user_id"])
    op.create_index("ix_reading_room_sessions_open", "reading_room_sessions", ["hall", "ended_at"])
    op.create_table(
        "reading_room_messages",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("hall", sa.String(length=16), nullable=False),
        sa.Column("round_id", sa.Uuid(as_uuid=True), sa.ForeignKey("rounds.id", ondelete="CASCADE"), nullable=True),
        sa.Column("user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("text", sa.String(length=300), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_reading_room_messages_hall_created", "reading_room_messages", ["hall", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_reading_room_messages_hall_created", table_name="reading_room_messages")
    op.drop_table("reading_room_messages")
    op.drop_index("ix_reading_room_sessions_open", table_name="reading_room_sessions")
    op.drop_index("ix_reading_room_sessions_user_id", table_name="reading_room_sessions")
    op.drop_table("reading_room_sessions")
