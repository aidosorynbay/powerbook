"""reader_awards.featured: the pin a reader chose to wear by their avatar

One new column with a default on a small table: safe on live data.

Revision ID: fa20261018a1
Revises: aw20261017a1
Create Date: 2026-10-18

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "fa20261018a1"
down_revision = "aw20261017a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("reader_awards", sa.Column("featured", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("reader_awards", "featured")
