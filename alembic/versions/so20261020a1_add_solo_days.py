"""solo_days, solo_day_books: reading outside the circle

The founder (2026-10-20): a reader not in the circle gets a dial and a calendar of their own, running alongside the
circle's, and the reading room's minutes go to their book on the shelf. Two new tables: safe on live data.

Revision ID: so20261020a1
Revises: dm20261018a1
Create Date: 2026-10-20

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "so20261020a1"
down_revision = "dm20261018a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "solo_days",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("minutes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "date", name="uq_solo_days_user_date"),
        sa.CheckConstraint("minutes >= 0", name="ck_solo_days_minutes_non_negative"),
    )
    op.create_index("ix_solo_days_user_id", "solo_days", ["user_id"])
    op.create_table(
        "solo_day_books",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("solo_day_id", sa.Uuid(), sa.ForeignKey("solo_days.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("title_norm", sa.String(length=300), nullable=False),
        sa.Column("minutes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("position", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("minutes >= 0", name="ck_solo_day_books_minutes_non_negative"),
    )
    op.create_index("ix_solo_day_books_solo_day_id", "solo_day_books", ["solo_day_id"])
    op.create_index("ix_solo_day_books_user_id", "solo_day_books", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_solo_day_books_user_id", table_name="solo_day_books")
    op.drop_index("ix_solo_day_books_solo_day_id", table_name="solo_day_books")
    op.drop_table("solo_day_books")
    op.drop_index("ix_solo_days_user_id", table_name="solo_days")
    op.drop_table("solo_days")
