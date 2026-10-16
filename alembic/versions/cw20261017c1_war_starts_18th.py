"""The first clan war runs 18–31 October 2026 (the founder moved the start to the 18th)

Data only: the dates of the one war row.

Revision ID: cw20261017c1
Revises: cw20261017b1
Create Date: 2026-10-17

"""
from __future__ import annotations

from alembic import op

revision = "cw20261017c1"
down_revision = "cw20261017b1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE clan_wars SET start_date = '2026-10-18', end_date = '2026-10-31' WHERE start_date = '2026-10-17'")


def downgrade() -> None:
    op.execute("UPDATE clan_wars SET start_date = '2026-10-17', end_date = '2026-10-30' WHERE start_date = '2026-10-18'")
