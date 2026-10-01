from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.books import (
    BookChatIn,
    BookChatReplyOut,
    BookChatStateOut,
    BookMatchOut,
    CatalogPageOut,
    ReviewIn,
    ShelfReviewOut,
    WatchOut,
    WatchStateOut,
    WorkOut,
)
from app.schemas.library import CoverOptionOut
from app.services import book_chat, books, notify, shelf_overrides

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


@router.get("/match", response_model=BookMatchOut)
def match(
    q: str = Query(min_length=2, max_length=200),
    editions: bool = Query(default=True),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> BookMatchOut:
    """«Какая это книга?»: the shared library's books first, then catalogue editions."""
    works = books.match_works(db, viewer_id=user.id, query=q)
    found = [CoverOptionOut(**option) for option in shelf_overrides.search_editions(q)[:10]] if editions else []
    return BookMatchOut(works=works, editions=found)


@router.get("/chat", response_model=BookChatStateOut)
def chat_state(
    volume_key: str | None = Query(default=None, max_length=80),
    work_key: str | None = Query(default=None, max_length=120),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> BookChatStateOut:
    """«Обсудить с AI»: the conversation so far about this book, and how many messages are left today."""
    return BookChatStateOut(**book_chat.state(db, user=user, volume_key=volume_key, work_key=work_key))


@router.post("/chat", response_model=BookChatReplyOut)
def chat_send(
    payload: BookChatIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> BookChatReplyOut:
    return BookChatReplyOut(
        **book_chat.send(
            db, user=user, volume_key=payload.volume_key, work_key=payload.work_key, text=payload.text, lang=payload.lang
        )
    )


@router.delete("/chat", status_code=status.HTTP_204_NO_CONTENT)
def chat_clear(
    volume_key: str | None = Query(default=None, max_length=80),
    work_key: str | None = Query(default=None, max_length=120),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    """Start the conversation about this book over."""
    book_chat.clear(db, user=user, volume_key=volume_key, work_key=work_key)


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



@router.get("/watches", response_model=list[WatchOut])
def my_watches(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[WatchOut]:
    """«Мои подписки»: the books this reader is waiting for."""
    return [WatchOut(**w) for w in notify.watches_for(db, user.id)]


@router.put("/watch/{key}", response_model=WatchStateOut)
def watch_book(key: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> WatchStateOut:
    """«Следить за книгой»: hear when it is on the bazaar or someone in the circle finishes it."""
    return WatchStateOut(**notify.watch(db, user=user, key=key))


@router.delete("/watch/{key}", response_model=WatchStateOut)
def unwatch_book(key: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> WatchStateOut:
    return WatchStateOut(**notify.unwatch(db, user=user, key=key))
