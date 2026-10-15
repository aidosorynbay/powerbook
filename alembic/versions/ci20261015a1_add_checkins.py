"""add checkins and direct_messages

«Хей, как вы, всё ок?»: the founder's message to a reader quiet for three
days in the circle (app/services/checkins.py), and the conversation it
opens between the reader and the founder on the site.

New tables only, so this is safe to apply to live data.

Revision ID: ci20261015a1
Revises: fb20261015a1
Create Date: 2026-10-15

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "ci20261015a1"
down_revision = "fb20261015a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "checkins",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("round_id", sa.Uuid(as_uuid=True), sa.ForeignKey("rounds.id", ondelete="CASCADE"), nullable=False),
        sa.Column("last_read", sa.Date(), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("status", sa.String(length=12), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("answer", sa.String(length=10), nullable=True),
        sa.Column("answered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "round_id", "last_read", name="uq_checkins_pause"),
    )
    op.create_index("ix_checkins_user_id", "checkins", ["user_id"])
    op.create_index("ix_checkins_status_day", "checkins", ["status", "day"])
    op.create_table(
        "direct_messages",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("reader_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("author_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("checkin_id", sa.Uuid(as_uuid=True), sa.ForeignKey("checkins.id", ondelete="SET NULL"), nullable=True),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_direct_messages_reader_created", "direct_messages", ["reader_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_direct_messages_reader_created", table_name="direct_messages")
    op.drop_table("direct_messages")
    op.drop_index("ix_checkins_status_day", table_name="checkins")
    op.drop_index("ix_checkins_user_id", table_name="checkins")
    op.drop_table("checkins")
