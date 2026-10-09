"""Every reader's past finishes get the days they were read on

The founder (2026-10-10): «Шантарам» finished on 15 May and «Магия утра» on
18 June means the reading from 16 May to 18 June went to «Магия утра». The
finish form has done this since e1f2a3b4c5d6 (book_finish.give_days); this
gives the whole history the same, for every reader: days with no book named
get filled rows of the next book finished (shared equally with a book read
alongside), never further back than «Дни чтения» can edit (EDIT_DAYS), and
days a reader named stay theirs. Each reader can correct it per book in
«Дни чтения». Running it again changes nothing.

Data only. It uses the app's own book_finish code as of this revision: on a
fresh database there is nothing to fill. Downgrade leaves the rows: they
cannot be told from the ones finishes made themselves.

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-10-10
"""
from __future__ import annotations

import logging

from alembic import op
from sqlalchemy.orm import Session

revision = "f2a3b4c5d6e7"
down_revision = "e1f2a3b4c5d6"
branch_labels = None
depends_on = None

log = logging.getLogger("alembic.runtime.migration")


def upgrade() -> None:
    import app.models  # noqa: F401
    from app.services import book_finish

    db = Session(bind=op.get_bind())
    try:
        done = book_finish.fill_everyone(db)
        db.flush()
    finally:
        db.close()
    log.info("history filled: %s readers, %s days carry a filled share", done["readers"], done["filled_days"])


def downgrade() -> None:
    pass
