"""add shelf_overrides.hidden

«Убрать с полки»: a finished day's comment that is no book title stands on
the shelf as a book; the reader can take it off the shelf (and out of the
shared library) without touching the day.

One column with a default, so this is safe to apply to live data.

Revision ID: a3b4c5d6e7f8
Revises: f2a3b4c5d6e7
Create Date: 2026-10-10
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "a3b4c5d6e7f8"
down_revision = "f2a3b4c5d6e7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("shelf_overrides", sa.Column("hidden", sa.Boolean(), server_default="false", nullable=False))


def downgrade() -> None:
    op.drop_column("shelf_overrides", "hidden")
