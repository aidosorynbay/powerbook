"""add buddy_messages, chat_consents, chat_accepts, chat_blocks, chat_reports

Private messages between readers on the site instead of Telegram (the founder,
2026-10-15), with what the legal check asked for: a provable consent (16+),
blocking, and complaints that carry the latest messages.

New tables only, so this is safe to apply to live data.

Revision ID: bc20261015a1
Revises: ci20261015a1
Create Date: 2026-10-15

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "bc20261015a1"
down_revision = "ci20261015a1"
branch_labels = None
depends_on = None


def _stamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]


def upgrade() -> None:
    user = lambda name: sa.Column(name, sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False)  # noqa: E731
    op.create_table(
        "buddy_messages",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        user("sender_id"),
        user("recipient_id"),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        *_stamps(),
        sa.CheckConstraint("sender_id <> recipient_id", name="ck_buddy_messages_not_self"),
    )
    op.create_index("ix_buddy_messages_pair", "buddy_messages", ["sender_id", "recipient_id", "created_at"])
    op.create_index("ix_buddy_messages_recipient_unread", "buddy_messages", ["recipient_id", "read_at"])
    op.create_table(
        "chat_consents",
        sa.Column("user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("version", sa.String(length=20), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "chat_accepts",
        sa.Column("user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("other_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "chat_blocks",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        user("blocker_id"),
        user("blocked_id"),
        *_stamps(),
        sa.UniqueConstraint("blocker_id", "blocked_id", name="uq_chat_blocks_pair"),
    )
    op.create_index("ix_chat_blocks_blocker_id", "chat_blocks", ["blocker_id"])
    op.create_index("ix_chat_blocks_blocked_id", "chat_blocks", ["blocked_id"])
    op.create_table(
        "chat_reports",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        user("reporter_id"),
        user("reported_id"),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("excerpt", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=12), nullable=False, server_default="new"),
        sa.Column("answer", sa.Text(), nullable=True),
        *_stamps(),
    )
    op.create_index("ix_chat_reports_reported_id", "chat_reports", ["reported_id"])


def downgrade() -> None:
    op.drop_index("ix_chat_reports_reported_id", table_name="chat_reports")
    op.drop_table("chat_reports")
    op.drop_index("ix_chat_blocks_blocked_id", table_name="chat_blocks")
    op.drop_index("ix_chat_blocks_blocker_id", table_name="chat_blocks")
    op.drop_table("chat_blocks")
    op.drop_table("chat_accepts")
    op.drop_table("chat_consents")
    op.drop_index("ix_buddy_messages_recipient_unread", table_name="buddy_messages")
    op.drop_index("ix_buddy_messages_pair", table_name="buddy_messages")
    op.drop_table("buddy_messages")
