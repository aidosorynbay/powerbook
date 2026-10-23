"""book_authors.display_title: the founder's word on what a book is called

The founder (2026-10-23): the Monk book's card showed the spelling most readers typed, without «свой»; he says the
right name. One nullable column, and the author may be empty now (a title said alone): safe on live data.

Revision ID: bt20261023a1
Revises: bp20261023a1
Create Date: 2026-10-23

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "bt20261023a1"
down_revision = "bp20261023a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("book_authors", sa.Column("display_title", sa.String(length=300), nullable=True))
    with op.batch_alter_table("book_authors") as batch:
        batch.alter_column("author", existing_type=sa.String(length=200), nullable=True)


def downgrade() -> None:
    op.execute("DELETE FROM book_authors WHERE author IS NULL")
    with op.batch_alter_table("book_authors") as batch:
        batch.alter_column("author", existing_type=sa.String(length=200), nullable=False)
    op.drop_column("book_authors", "display_title")
