from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.books import CatalogPageOut, ReviewIn, ShelfReviewOut, WorkOut
from app.services import books

router = APIRouter(prefix="/books", tags=["books"])


@router.get("/catalog", response_model=CatalogPageOut)
def catalog_page(
    q: str = Query(default="", max_length=120),
    filter: str = Query(default="all", pattern="^(all|rated|reviewed|sale)$"),
    sort: str = Query(default="popular", pattern="^(popular|pb|ext|new|az)$"),
    topic: str | None = Query(default=None, max_length=30),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=48, ge=1, le=120),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> CatalogPageOut:
    return books.catalog_page(
        db, viewer_id=user.id, q=q, filter_=filter, sort=sort, topic=topic, offset=offset, limit=limit
    )


@router.get("/work/{key}", response_model=WorkOut)
def work_page(
    key: str,
    locale: str = Query(default="ru", pattern="^(ru|kk|en)$"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> WorkOut:
    return books.work_page(db, key=key, viewer_id=user.id, locale=locale)


@router.put("/reviews", response_model=ShelfReviewOut)
def save_review(
    payload: ReviewIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ShelfReviewOut:
    return books.save_review(db, user=user, payload=payload)


@router.delete("/reviews/{review_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_review(
    review_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    books.delete_review(db, user=user, review_id=review_id)
