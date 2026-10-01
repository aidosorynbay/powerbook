"""The shared library's pages and the marks readers give their books.

A mark is given on the reader's own shelf, out of ten, with a few words or
none. From that moment it is public: it shows on the reader's shelf, on the
book's page here, and counts in the book's PowerBook rating.
"""
from __future__ import annotations

import uuid
from collections import defaultdict
from dataclasses import dataclass

import re

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.book_fact import BookFact
from app.models.book_listing import BookListing
from app.models.book_review import BookReview
from app.models.user import User
from app.repositories.claims import ClaimsRepository
from app.schemas.books import (
    CatalogCountsOut,
    CatalogItemOut,
    CatalogPageOut,
    ReviewIn,
    ReviewOut,
    ShelfReviewOut,
    TextWithSourceOut,
    WorkOut,
    WorkReaderOut,
)
from app.services import catalog
from app.services.catalog import CatalogIndex, Work

SORTS = ("popular", "pb", "ext", "new", "az")
FILTERS = ("all", "rated", "reviewed", "sale")

# A book with two tens and nothing else should not outrank one with forty
# eights: every rating starts from this many marks of this value.
_PRIOR_VOTES = 3
_PRIOR_MEAN = 7.0


def _cover_urls(work: Work) -> tuple[str | None, str | None]:
    if not work.image:
        return None, None
    return f"/library/covers/{work.image}.jpg", f"/library/covers/{work.image}-s.jpg"


@dataclass
class _Marks:
    total: int = 0
    votes: int = 0
    reviews: int = 0

    @property
    def mean(self) -> float | None:
        return round(self.total / self.votes, 1) if self.votes else None

    @property
    def weighted(self) -> float:
        return (self.total + _PRIOR_MEAN * _PRIOR_VOTES) / (self.votes + _PRIOR_VOTES)


def _marks(db: Session, idx: CatalogIndex) -> dict[str, _Marks]:
    out: dict[str, _Marks] = defaultdict(_Marks)
    for key, rating, text in db.execute(select(BookReview.work_key, BookReview.rating, BookReview.text)).all():
        work = idx.find(key)
        if work is None:
            continue
        m = out[work.key]
        m.total += rating
        m.votes += 1
        if text and text.strip():
            m.reviews += 1
    return out


def facts_by_work(db: Session, idx: CatalogIndex) -> dict[str, BookFact]:
    """Each book's facts row. A book whose key moved since its facts were
    fetched still finds them under the key it had then."""
    out: dict[str, BookFact] = {}
    for row in db.execute(select(BookFact)).scalars().all():
        work = idx.find(row.key)
        if work is None:
            continue
        held = out.get(work.key)
        if held is None or (row.key == work.key and held.key != work.key) or (held.status != "found" and row.status == "found"):
            out[work.key] = row
    return out


def _for_sale(db: Session, idx: CatalogIndex) -> dict[str, int]:
    out: dict[str, int] = defaultdict(int)
    for key, n in db.execute(
        select(BookListing.work_key, func.count())
        .where(BookListing.status == "active", BookListing.work_key.is_not(None))
        .group_by(BookListing.work_key)
    ).all():
        work = idx.find(key)
        if work is not None:
            out[work.key] += int(n)
    return out


def _mine(db: Session, idx: CatalogIndex, viewer_id: uuid.UUID) -> dict[str, BookReview]:
    out: dict[str, BookReview] = {}
    for review in db.execute(select(BookReview).where(BookReview.user_id == viewer_id)).scalars().all():
        work = idx.find(review.work_key)
        if work is not None:
            out[work.key] = review
    return out


def _external(fact: BookFact | None) -> tuple[float | None, int, int | None, str | None]:
    if fact is None or fact.rating is None:
        return None, 5, None, None
    return round(float(fact.rating), 2), fact.rating_scale or 5, fact.ratings_count, fact.rating_source


def _item(work: Work, marks: _Marks | None, fact: BookFact | None, sale: int, mine: BookReview | None) -> CatalogItemOut:
    cover, thumb = _cover_urls(work)
    ext, scale, votes, source = _external(fact)
    return CatalogItemOut(
        key=work.key,
        title=work.title,
        author=work.author,
        cover_url=cover,
        cover_thumb_url=thumb,
        readers=len(work.readers),
        pb_rating=marks.mean if marks else None,
        pb_votes=marks.votes if marks else 0,
        pb_reviews=marks.reviews if marks else 0,
        ext_rating=ext,
        ext_scale=scale,
        ext_votes=votes,
        ext_source=source,
        for_sale=sale,
        my_rating=mine.rating if mine else None,
        topics=list(fact.topics or []) if fact else [],
    )


def catalog_page(
    db: Session,
    *,
    viewer_id: uuid.UUID,
    q: str = "",
    filter_: str = "all",
    sort: str = "popular",
    topic: str | None = None,
    offset: int = 0,
    limit: int = 48,
) -> CatalogPageOut:
    idx = catalog.index(db)
    marks = _marks(db, idx)
    facts = facts_by_work(db, idx)
    sale = _for_sale(db, idx)
    mine = _mine(db, idx, viewer_id)

    found = [w for w in idx.works.values() if catalog.search_matches(w, q)] if q.strip() else list(idx.works.values())
    counts = CatalogCountsOut(
        all=len(found),
        rated=sum(1 for w in found if w.key in marks),
        reviewed=sum(1 for w in found if marks.get(w.key, _Marks()).reviews > 0),
        sale=sum(1 for w in found if sale.get(w.key)),
    )
    if filter_ == "rated":
        found = [w for w in found if w.key in marks]
    elif filter_ == "reviewed":
        found = [w for w in found if marks.get(w.key, _Marks()).reviews > 0]
    elif filter_ == "sale":
        found = [w for w in found if sale.get(w.key)]

    topic_counts: dict[str, int] = defaultdict(int)
    for w in found:
        for t in (facts[w.key].topics or []) if w.key in facts else []:
            topic_counts[t] += 1
    if topic:
        found = [w for w in found if w.key in facts and topic in (facts[w.key].topics or [])]

    def ext_norm(w: Work) -> float:
        fact = facts.get(w.key)
        if fact is None or fact.rating is None:
            return -1.0
        return float(fact.rating) / float(fact.rating_scale or 5)

    popularity = lambda w: (-len(w.readers), -marks.get(w.key, _Marks()).votes, w.title.casefold())  # noqa: E731
    if sort == "pb":
        found.sort(key=lambda w: (w.key not in marks, -marks[w.key].weighted if w.key in marks else 0, *popularity(w)))
    elif sort == "ext":
        found.sort(key=lambda w: (-ext_norm(w), *popularity(w)))
    elif sort == "new":
        found.sort(key=lambda w: (w.last_at is None, -(w.last_at.toordinal() if w.last_at else 0), *popularity(w)))
    elif sort == "az":
        found.sort(key=lambda w: w.title.casefold())
    else:
        found.sort(key=popularity)

    page = found[offset : offset + limit]
    return CatalogPageOut(
        items=[_item(w, marks.get(w.key), facts.get(w.key), sale.get(w.key, 0), mine.get(w.key)) for w in page],
        total=len(found),
        offset=offset,
        counts=counts,
        topics=dict(topic_counts),
    )


def _review_out(review: BookReview, user: User, viewer_id: uuid.UUID) -> ReviewOut:
    return ReviewOut(
        id=review.id,
        user_id=str(user.id),
        display_name=user.display_name or user.username,
        avatar_data=user.avatar_data,
        rating=review.rating,
        text=review.text,
        created_at=review.created_at,
        updated_at=review.updated_at,
        is_viewer=user.id == viewer_id,
    )


def _localized(value: dict | None, locale: str) -> tuple[str, dict] | None:
    if not value:
        return None
    for lang in (locale, "ru", "en", "kk"):
        entry = value.get(lang)
        if entry:
            return lang, entry if isinstance(entry, dict) else {"text": entry}
    return None


def work_page(db: Session, *, key: str, viewer_id: uuid.UUID, locale: str = "ru") -> WorkOut:
    from app.services import market, notify

    idx = catalog.index(db)
    work = idx.find(key)
    if work is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="book_not_found")

    reviews = db.execute(
        select(BookReview, User)
        .join(User, User.id == BookReview.user_id)
        .where(BookReview.work_key.in_(list(work.members)))
        .order_by(BookReview.updated_at.desc())
    ).all()
    marks = _Marks()
    histogram = [0] * 10
    out_reviews: list[ReviewOut] = []
    my_review: ReviewOut | None = None
    for review, user in reviews:
        marks.total += review.rating
        marks.votes += 1
        histogram[review.rating - 1] += 1
        has_text = bool(review.text and review.text.strip())
        if has_text:
            marks.reviews += 1
        item = _review_out(review, user, viewer_id)
        if user.id == viewer_id:
            my_review = item
        out_reviews.append(item)
    # Words first, then marks alone; newest first within each.
    out_reviews.sort(key=lambda r: not (r.text and r.text.strip()))

    fact = facts_by_work(db, idx).get(work.key)
    listings = market.listings_for_work(db, work=work, viewer_id=viewer_id, idx=idx)

    viewer_ids = set(ClaimsRepository(db).effective_user_ids(user_id=viewer_id))
    my_volume = next((vk for acc, vk in work.holders.items() if acc in viewer_ids), None)

    viewer_person = idx.person_of(viewer_id)
    accounts = [idx.account_of(p) for p in work.readers]
    found = db.execute(
        select(User.id, User.display_name, User.username, User.avatar_data, User.is_claimable).where(User.id.in_(accounts))
    ).all() if accounts else []
    readers = [
        WorkReaderOut(
            user_id=str(uid),
            display_name=name or username,
            avatar_data=avatar,
            is_archive=bool(archive),
            is_viewer=idx.person_of(uid) == viewer_person,
        )
        for uid, name, username, avatar, archive in found
    ]
    readers.sort(key=lambda r: (not r.is_viewer, r.is_archive, r.avatar_data is None, r.display_name.lower()))

    base = _item(work, marks if marks.votes else None, fact, sum(1 for l in listings if l.status == "active"), None)
    about = readers_say = None
    if fact is not None:
        picked = _localized(fact.about, locale)
        if picked:
            _, entry = picked
            about = TextWithSourceOut(text=entry.get("text", ""), source=entry.get("source") or "wikipedia", url=entry.get("url"))
        picked = _localized(fact.review, locale)
        if picked:
            _, entry = picked
            readers_say = TextWithSourceOut(text=entry.get("text", ""), source=fact.review_source or "goodreads", url=fact.rating_url)

    return WorkOut(
        **base.model_dump(exclude={"my_rating"}),
        my_rating=my_review.rating if my_review else None,
        ext_url=fact.rating_url if fact else None,
        goodreads_url=fact.goodreads_url if fact else None,
        source_url=work.source_url,
        about=about,
        readers_say=readers_say,
        pages=fact.pages if fact else None,
        year=fact.year if fact else None,
        facts_status=fact.status if fact else None,
        histogram=histogram,
        reviews=out_reviews[:100],
        readers_list=readers[:24],
        my_review=my_review,
        my_volume_key=my_volume,
        listings=listings,
        watching=notify.is_watching(db, viewer_id, work),
        watchers=notify.watchers_count(db, work),
    )


# ---------- marks ----------


def reviews_for_shelf(db: Session, owner_id: uuid.UUID) -> list[BookReview]:
    return list(db.execute(select(BookReview).where(BookReview.user_id == owner_id)).scalars().all())


def save_review(db: Session, *, user: User, payload: ReviewIn) -> ShelfReviewOut:
    from app.services.bookcase import BookcaseService

    shelf = BookcaseService(db).bookcase(owner_id=user.id, viewer_id=user.id)
    volume = next((b for b in shelf.books if b.key == payload.volume_key), None)
    if volume is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="book_not_on_shelf")

    idx = catalog.index(db)
    candidates = [k for k in (volume.match_key, catalog.work_key(volume.title)) if k]
    key = next((k for k in candidates if idx.find(k) is not None), None) or (candidates[0] if candidates else None)
    if not key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="no_title")
    work = idx.find(key)

    review = db.execute(
        select(BookReview).where(BookReview.user_id == user.id, BookReview.volume_key == volume.key)
    ).scalar_one_or_none()
    same_book = db.execute(
        select(BookReview).where(BookReview.user_id == user.id, BookReview.work_key == key)
    ).scalar_one_or_none()
    if review is None:
        review = same_book
    elif same_book is not None and same_book.id != review.id:
        # Two copies of one book on the shelf: one mark for the book.
        db.delete(same_book)
        db.flush()
    if review is None:
        review = BookReview(user_id=user.id, work_key=key, rating=payload.rating)
        db.add(review)
    review.work_key = key
    review.volume_key = volume.key
    review.title = (work.title if work else volume.title)[:300]
    review.author = ((work.author if work else None) or volume.author or None)
    review.author = review.author[:200] if review.author else None
    review.rating = payload.rating
    text = (payload.text or "").strip()
    review.text = text or None
    db.commit()
    db.refresh(review)
    catalog.invalidate()
    return ShelfReviewOut.model_validate(review, from_attributes=True)


def delete_review(db: Session, *, user: User, review_id: uuid.UUID) -> None:
    review = db.get(BookReview, review_id)
    if review is None or review.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="review_not_found")
    db.delete(review)
    db.commit()
    catalog.invalidate()


_TOKENS = re.compile(r"[\s_\-.,:;!?()\[\]«»\"'/]+")


def match_works(db: Session, *, viewer_id: uuid.UUID, query: str, limit: int = 8) -> list[CatalogItemOut]:
    """Books of the shared library a file or a typed title could be.

    A file name says more than a title ("Clear_James_-_Atomic_Habits"), so it
    is taken word by word: a book matches when most of the words are in its
    title, author or any spelling it is known by, at least one of them in
    the title.
    """
    from app.core.booktitles import match_key

    idx = catalog.index(db)
    words = [k for k in (match_key(w) for w in _TOKENS.split(query)) if len(k) >= 3]
    scored: list[tuple[float, Work]] = []
    for work in idx.works.values():
        if catalog.search_matches(work, query):
            scored.append((1.0, work))
            continue
        if not words:
            continue
        titles = " ".join([match_key(work.title), *work.members])
        haystack = f"{titles} {match_key(work.author or '')}"
        hits = [w for w in words if w in haystack]
        if not hits or not any(w in titles for w in hits):
            continue
        share = len(hits) / len(words)
        if share >= 0.5:
            scored.append((share, work))
    scored.sort(key=lambda x: (-x[0], -len(x[1].readers), x[1].title.casefold()))
    best = [w for _s, w in scored[:limit]]
    if not best:
        return []
    marks = _marks(db, idx)
    facts = facts_by_work(db, idx)
    sale = _for_sale(db, idx)
    mine = _mine(db, idx, viewer_id)
    return [_item(w, marks.get(w.key), facts.get(w.key), sale.get(w.key, 0), mine.get(w.key)) for w in best]
