"""users.display_mode: who opens PowerBook as an app on the home screen

Three nullable columns on users: safe on live data.

Revision ID: dm20261018a1
Revises: fa20261018a1
Create Date: 2026-10-18

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "dm20261018a1"
down_revision = "fa20261018a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("display_mode", sa.String(20), nullable=True))
    op.add_column("users", sa.Column("display_mode_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("app_first_open_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "app_first_open_at")
    op.drop_column("users", "display_mode_at")
    op.drop_column("users", "display_mode")
