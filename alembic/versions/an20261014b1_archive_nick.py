"""users.archive_nick: the archive's old Telegram nicknames leave telegram_id

The 2026-08-10 import wrote every past reader's old nickname into
telegram_id, the unique column that means "this Telegram is this account".
A returning reader who signed up with that same Telegram was then refused
("Telegram ID already linked to another account") by their own archive and
could not get in at all (2026-10-14, @azirgejalgyz).

The nickname moves to archive_nick, which is only a label to match a claim
by, and telegram_id on archive accounts becomes NULL, so registration never
runs into the archive again.

Revision ID: an20261014b1
Revises: gr20261014a1
Create Date: 2026-10-14

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "an20261014b1"
down_revision = "gr20261014a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("archive_nick", sa.String(length=120), nullable=True))
    op.create_index("ix_users_archive_nick", "users", ["archive_nick"])
    op.execute(
        "UPDATE users SET archive_nick = telegram_id, telegram_id = NULL "
        "WHERE is_claimable AND telegram_id IS NOT NULL"
    )


def downgrade() -> None:
    # Give the nickname back only where nobody has registered with it since.
    op.execute(
        "UPDATE users SET telegram_id = archive_nick "
        "WHERE is_claimable AND telegram_id IS NULL AND archive_nick IS NOT NULL "
        "AND archive_nick NOT IN (SELECT telegram_id FROM users WHERE telegram_id IS NOT NULL)"
    )
    op.drop_index("ix_users_archive_nick", table_name="users")
    op.drop_column("users", "archive_nick")
