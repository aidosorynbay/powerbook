"""Add unique constraint to telegram_id

Revision ID: f3a1b2c4d5e6
Revises: 90f5e384b67f
Create Date: 2026-04-02
"""
from alembic import op

revision = "f3a1b2c4d5e6"
down_revision = "46d802c5b8ff"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_unique_constraint("uq_users_telegram_id", "users", ["telegram_id"])


def downgrade() -> None:
    op.drop_constraint("uq_users_telegram_id", "users", type_="unique")
