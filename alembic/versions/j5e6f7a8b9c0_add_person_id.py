"""link archive accounts that are the same person

Revision ID: j5e6f7a8b9c0
Revises: i4d5e6f7a8b9
Create Date: 2026-08-16

One reader often appears in the archive several times — the circles were
kept in spreadsheets and the same person was written down as "Saira",
"Saira khanym" and "Saira khnm" in different months. Accounts sharing a
person_id are one human; NULL means the account stands alone.
"""
from alembic import op
import sqlalchemy as sa


revision = 'j5e6f7a8b9c0'
down_revision = 'i4d5e6f7a8b9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('person_id', sa.Uuid(as_uuid=True), nullable=True))
    op.create_index('ix_users_person_id', 'users', ['person_id'])


def downgrade() -> None:
    op.drop_index('ix_users_person_id', table_name='users')
    op.drop_column('users', 'person_id')
