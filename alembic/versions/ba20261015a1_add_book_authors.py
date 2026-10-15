"""add book_authors and book_covers.author_checked_at

One book, one author. «Три товарища» showed Remarque on some readers'
shelves and another name on others (2026-10-15): each spelling's cover
lookup named its own author, and a reader's own «Ремарк» after the title
stood over the lookup. Now the shared library decides who wrote a book from
every source together; the founder can name the author outright (book_authors), and
a lookup whose book's sources disagree is asked again once
(author_checked_at).

A new table and a nullable column, so this is safe to apply to live data.

Revision ID: ba20261015a1
Revises: rr20261014a1
Create Date: 2026-10-15

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "ba20261015a1"
down_revision = "rr20261014a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "book_authors",
        sa.Column("key", sa.String(120), primary_key=True),
        sa.Column("author", sa.String(200), nullable=False),
        sa.Column("title", sa.String(300), nullable=True),
        sa.Column("created_by", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.add_column("book_covers", sa.Column("author_checked_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("book_covers", "author_checked_at")
    op.drop_table("book_authors")
