"""clan_war_messages + clan_war_reports: the team chat of «Битва кланов»

New tables only: safe on live data.

Revision ID: cw20261017e1
Revises: cw20261017d1
Create Date: 2026-10-17

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "cw20261017e1"
down_revision = "cw20261017d1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "clan_war_messages",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("war_id", sa.Uuid(as_uuid=True), sa.ForeignKey("clan_wars.id", ondelete="CASCADE"), nullable=False),
        sa.Column("team", sa.SmallInteger(), nullable=False),
        sa.Column("user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
        sa.Column("kind", sa.String(8), nullable=False, server_default="user"),
        sa.Column("text", sa.Text(), nullable=True),
        sa.Column("code", sa.String(24), nullable=True),
        sa.Column("params", sa.JSON(), nullable=True),
        sa.Column("key", sa.String(40), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("war_id", "team", "key", name="uq_clan_war_message_key"),
    )
    op.create_index("ix_clan_war_messages_war_id", "clan_war_messages", ["war_id"])
    op.create_index("ix_clan_war_messages_user_id", "clan_war_messages", ["user_id"])
    op.create_table(
        "clan_war_reports",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("message_id", sa.Uuid(as_uuid=True), sa.ForeignKey("clan_war_messages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("reporter_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_clan_war_reports_message_id", "clan_war_reports", ["message_id"])


def downgrade() -> None:
    op.drop_index("ix_clan_war_reports_message_id", table_name="clan_war_reports")
    op.drop_table("clan_war_reports")
    op.drop_index("ix_clan_war_messages_user_id", table_name="clan_war_messages")
    op.drop_index("ix_clan_war_messages_war_id", table_name="clan_war_messages")
    op.drop_table("clan_war_messages")
