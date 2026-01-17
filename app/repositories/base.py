from __future__ import annotations

from typing import Generic, TypeVar

from sqlalchemy.orm import Session

TModel = TypeVar("TModel")


class BaseRepository(Generic[TModel]):
    def __init__(self, db: Session) -> None:
        self.db = db

