"""add is_claimable to users and username_claims table

Revision ID: c1d4e6f8a9b0
Revises: b3d8f1a2c5e7
Create Date: 2026-08-11 00:00:00.000000

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = 'c1d4e6f8a9b0'
down_revision = 'b3d8f1a2c5e7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'users',
        sa.Column('is_claimable', sa.Boolean(), nullable=False, server_default='false'),
    )

    # Backfill: mark the placeholder accounts created by the historical
    # archive import (a single batch, 2026-08-10 18:13:10 - 18:17:52 UTC) as
    # claimable. Real registrations fall outside this narrow window.
    op.execute(
        """
        UPDATE users
        SET is_claimable = true
        WHERE created_at >= '2026-08-10 18:13:00+00'
          AND created_at <= '2026-08-10 18:18:00+00'
        """
    )

    claim_status = postgresql.ENUM('approved', 'revoked', name='claim_status')
    claim_status.create(op.get_bind())

    op.create_table(
        'username_claims',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('claimant_user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('ghost_user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('status', postgresql.ENUM('approved', 'revoked', name='claim_status', create_type=False), nullable=False, server_default='approved'),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('reviewed_by_user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['claimant_user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['ghost_user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['reviewed_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.UniqueConstraint('claimant_user_id', 'ghost_user_id', name='uq_username_claims_claimant_ghost'),
    )
    op.create_index('ix_username_claims_claimant_user_id', 'username_claims', ['claimant_user_id'])
    op.create_index('ix_username_claims_ghost_user_id', 'username_claims', ['ghost_user_id'])


def downgrade() -> None:
    op.drop_index('ix_username_claims_ghost_user_id', table_name='username_claims')
    op.drop_index('ix_username_claims_claimant_user_id', table_name='username_claims')
    op.drop_table('username_claims')
    op.execute('DROP TYPE claim_status')
    op.drop_column('users', 'is_claimable')
