"""add unknown gender enum value

Revision ID: a7c2e9f01b34
Revises: f3a1b2c4d5e6
Create Date: 2026-08-10 00:00:00.000000

"""
from __future__ import annotations

from alembic import op


revision = 'a7c2e9f01b34'
down_revision = 'f3a1b2c4d5e6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The Gender Python enum (app/models/enums.py) already defines "unknown",
    # but the Postgres enum type was never updated to match (it only has
    # male/female). This brings the DB enum in line with the code.
    op.execute("ALTER TYPE gender ADD VALUE IF NOT EXISTS 'unknown'")


def downgrade() -> None:
    # Postgres does not support removing enum values directly.
    # Intentionally a no-op; reverting would require recreating the type.
    pass
