from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings

_engine: Engine | None = None
_session_factory: sessionmaker[Session] | None = None


def get_engine() -> Engine:
    """
    Lazily create the SQLAlchemy engine.

    We keep this lazy so the app can still boot for non-DB endpoints while MVP
    wiring is in progress (as long as no DB-dependent code runs).
    """

    global _engine
    if _engine is not None:
        return _engine

    if not settings.database_url:
        raise RuntimeError(
            "DATABASE_URL is not set. Add it to your .env (see env.example)."
        )

    _engine = create_engine(
        settings.database_url,
        echo=settings.db_echo,
        pool_pre_ping=True,
    )
    return _engine


def get_session_factory() -> sessionmaker[Session]:
    global _session_factory
    if _session_factory is None:
        _session_factory = sessionmaker(
            bind=get_engine(),
            autoflush=False,
            autocommit=False,
            class_=Session,
        )
    return _session_factory


def get_db() -> Generator[Session, None, None]:
    """
    FastAPI dependency providing a DB session.
    """

    SessionLocal = get_session_factory()
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

