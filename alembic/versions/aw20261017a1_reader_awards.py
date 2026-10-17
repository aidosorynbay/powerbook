"""reader_awards: the awards each reader holds, kept for good («Мои награды»)

New table only: safe on live data. The awards are worked out from the reading
logs (app/services/awards.py); a row is written the first time one is found
and is never taken back, with the moment the reader was shown it.

Revision ID: aw20261017a1
Revises: cw20261017e1
Create Date: 2026-10-17

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "aw20261017a1"
down_revision = "cw20261017e1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "reader_awards",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("key", sa.String(40), nullable=False),
        sa.Column("earned_on", sa.Date(), nullable=False),
        sa.Column("seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "key", name="uq_reader_award_user_key"),
    )
    op.create_index("ix_reader_awards_user_id", "reader_awards", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_reader_awards_user_id", table_name="reader_awards")
    op.drop_table("reader_awards")
