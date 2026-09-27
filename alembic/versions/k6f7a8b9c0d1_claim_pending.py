"""claims wait for review instead of granting history immediately

Revision ID: k6f7a8b9c0d1
Revises: j5e6f7a8b9c0
Create Date: 2026-08-16

A claim used to be created already approved, so anyone signed in could
absorb any unclaimed archive nickname's statistics on the spot. Now a claim
starts as pending and grants nothing until the founder approves it — which
matters more since one claim now takes a whole merged person.

Existing rows are left exactly as they are; only the default changes.
"""
from alembic import op


revision = 'k6f7a8b9c0d1'
down_revision = 'j5e6f7a8b9c0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # PG 12+ allows this inside a transaction as long as the new label is not
    # used before commit — this migration only declares it.
    op.execute("ALTER TYPE claim_status ADD VALUE IF NOT EXISTS 'pending'")


def downgrade() -> None:
    # Postgres cannot drop a label from an enum type. Anything still pending
    # is moved aside so the label is unused, but the label itself remains.
    op.execute("UPDATE username_claims SET status = 'revoked' WHERE status = 'pending'")
