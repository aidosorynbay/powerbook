"""The book market: readers selling the books off their shelves to each other.

PowerBook only shows the listing — the book, its price and condition, and
how to reach the seller (their Telegram from the profile, and any phone or
WhatsApp number they add). The two readers agree on the rest themselves.
"""
from __future__ import annotations

import base64
import re
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.photos import DATA_URL as _DATA_URL
from app.core.photos import check_photo as _check_photo
from app.models.book_listing import BookListing
from app.models.user import User
from app.schemas.books import ListingIn, ListingOut, ListingPatch, MarketPageOut, SellerOut
from app.services import catalog
from app.services.catalog import CatalogIndex, Work

# Enough for a reader clearing a whole bookcase; a runaway client cannot flood the market.
MAX_ACTIVE = 60


def _bad(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def _phone(contact: str | None) -> str:
    """The seller's number as they wrote it, once it holds a real phone:
    10 to 15 digits, whatever spaces, brackets or dashes go around them."""
    value = (contact or "").strip()[:120]
    digits = re.sub(r"\D", "", value)
    if not 10 <= len(digits) <= 15:
        raise _bad("bad_phone")
    return value


def _clean(text: str | None, limit: int) -> str | None:
    value = (text or "").strip()
    return value[:limit] or None


def _telegram(handle: str | None) -> str | None:
    if not handle:
        return None
    return handle.strip().lstrip("@") or None


def _out(
    listing: BookListing,
    seller: User,
    *,
    viewer_id: uuid.UUID,
    idx: CatalogIndex | None,
    facts: dict | None = None,
    marks: dict | None = None,
    with_avatar: bool = False,
) -> ListingOut:
    work = idx.find(listing.work_key) if idx and listing.work_key else None
    cover = thumb = None
    if work and work.image:
        cover, thumb = f"/library/covers/{work.image}.jpg", f"/library/covers/{work.image}-s.jpg"
    fact = facts.get(work.key) if (facts is not None and work) else None
    mark = marks.get(work.key) if (marks is not None and work) else None
    return ListingOut(
        id=listing.id,
        title=listing.title,
        author=listing.author,
        # Only a book the shared library has: a link to anything else leads nowhere.
        work_key=work.key if work else None,
        volume_key=listing.volume_key if listing.seller_id == viewer_id else None,
        price=listing.price,
        condition=listing.condition,
        city=listing.city,
        contact=listing.contact,
        note=listing.note,
        photo_url=f"/market/{listing.id}/photo?v={int(listing.updated_at.timestamp())}" if listing.photo else None,
        cover_url=cover,
        cover_thumb_url=thumb,
        status=listing.status,
        created_at=listing.created_at,
        seller=SellerOut(
            user_id=str(seller.id),
            display_name=seller.display_name or seller.username,
            avatar_data=seller.avatar_data if with_avatar else None,
            telegram=_telegram(seller.telegram_id),
        ),
        is_mine=listing.seller_id == viewer_id,
        pb_rating=mark.mean if mark else None,
        ext_rating=round(float(fact.rating), 2) if fact is not None and fact.rating is not None else None,
        ext_scale=(fact.rating_scale or 5) if fact is not None else 5,
        ext_source=fact.rating_source if fact is not None else None,
    )


def _context(db: Session) -> tuple[CatalogIndex, dict, dict]:
    from app.services.books import _marks, facts_by_work

    idx = catalog.index(db)
    return idx, facts_by_work(db, idx), _marks(db, idx)


def market_page(
    db: Session,
    *,
    viewer_id: uuid.UUID,
    q: str = "",
    city: str | None = None,
    sort: str = "new",
    offset: int = 0,
    limit: int = 48,
) -> MarketPageOut:
    stmt = (
        select(BookListing, User)
        .join(User, User.id == BookListing.seller_id)
        .where(BookListing.status.in_(("active", "reserved")), User.is_active.is_(True))
    )
    rows = db.execute(stmt).all()
    idx, facts, marks = _context(db)
    folded = q.casefold().strip()
    if folded:
        rows = [
            (l, u)
            for l, u in rows
            if folded in f"{l.title} {l.author or ''} {l.note or ''}".casefold()
            or folded in (u.display_name or "").casefold()
        ]
    cities = sorted({l.city.strip() for l, _ in rows if l.city and l.city.strip()}, key=str.casefold)
    if city:
        rows = [(l, u) for l, u in rows if (l.city or "").strip().casefold() == city.strip().casefold()]
    if sort == "cheap":
        rows.sort(key=lambda r: (r[0].status != "active", r[0].price, -r[0].created_at.timestamp()))
    elif sort == "dear":
        rows.sort(key=lambda r: (r[0].status != "active", -r[0].price, -r[0].created_at.timestamp()))
    else:
        rows.sort(key=lambda r: (r[0].status != "active", -r[0].created_at.timestamp()))
    page = rows[offset : offset + limit]
    return MarketPageOut(
        items=[_out(l, u, viewer_id=viewer_id, idx=idx, facts=facts, marks=marks) for l, u in page],
        total=len(rows),
        offset=offset,
        cities=cities,
    )


def listing(db: Session, *, listing_id: uuid.UUID, viewer_id: uuid.UUID) -> ListingOut:
    row = db.execute(
        select(BookListing, User).join(User, User.id == BookListing.seller_id).where(BookListing.id == listing_id)
    ).first()
    if row is None or (row[0].status == "hidden" and row[0].seller_id != viewer_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="listing_not_found")
    idx, facts, marks = _context(db)
    return _out(row[0], row[1], viewer_id=viewer_id, idx=idx, facts=facts, marks=marks, with_avatar=True)


def listings_for_user(db: Session, *, seller_id: uuid.UUID, viewer_id: uuid.UUID) -> list[ListingOut]:
    """A reader's books for sale, as their profile shows them. Their own
    view also keeps what they sold and what they took down."""
    seller = db.get(User, seller_id)
    if seller is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    shown = ("active", "reserved", "sold", "hidden") if seller_id == viewer_id else ("active", "reserved")
    rows = db.execute(
        select(BookListing)
        .where(BookListing.seller_id == seller_id, BookListing.status.in_(shown))
        .order_by(BookListing.created_at.desc())
    ).scalars().all()
    idx, facts, marks = _context(db)
    order = {"active": 0, "reserved": 1, "sold": 2, "hidden": 3}
    out = [_out(l, seller, viewer_id=viewer_id, idx=idx, facts=facts, marks=marks) for l in rows]
    out.sort(key=lambda o: order.get(o.status, 4))
    return out


def listings_for_work(db: Session, *, work: Work, viewer_id: uuid.UUID, idx: CatalogIndex) -> list[ListingOut]:
    rows = db.execute(
        select(BookListing, User)
        .join(User, User.id == BookListing.seller_id)
        .where(BookListing.work_key.in_(list(work.members)), BookListing.status.in_(("active", "reserved")))
        .order_by(BookListing.price.asc())
    ).all()
    return [_out(l, u, viewer_id=viewer_id, idx=idx) for l, u in rows]


def _link_work(db: Session, seller_id: uuid.UUID, title: str, volume_key: str | None) -> tuple[str | None, str | None]:
    """The book this listing is in the shared library, if it is one: from the
    seller's shelf when they sell from it, else by the title typed."""
    idx = catalog.index(db)
    if volume_key:
        for work in idx.works.values():
            if work.holders.get(seller_id) == volume_key:
                return work.key, volume_key
    key = catalog.work_key(title)
    work = idx.find(key)
    return (work.key if work else key), volume_key


def create(db: Session, *, seller: User, payload: ListingIn) -> ListingOut:
    active = db.execute(
        select(func.count()).where(BookListing.seller_id == seller.id, BookListing.status.in_(("active", "reserved")))
    ).scalar_one()
    if active >= MAX_ACTIVE:
        raise _bad("too_many_listings")
    title = _clean(payload.title, 300)
    if not title:
        raise _bad("empty_title")
    work_key, volume_key = _link_work(db, seller.id, title, _clean(payload.volume_key, 80))
    row = BookListing(
        seller_id=seller.id,
        title=title,
        author=_clean(payload.author, 200),
        work_key=work_key,
        volume_key=volume_key,
        price=payload.price,
        condition=payload.condition,
        city=_clean(payload.city, 80),
        contact=_phone(payload.contact),
        note=_clean(payload.note, 1000),
        photo=_check_photo(payload.photo),
        status="active",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return listing(db, listing_id=row.id, viewer_id=seller.id)


def _own(db: Session, seller_id: uuid.UUID, listing_id: uuid.UUID) -> BookListing:
    row = db.get(BookListing, listing_id)
    if row is None or row.seller_id != seller_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="listing_not_found")
    return row


def update(db: Session, *, seller: User, listing_id: uuid.UUID, payload: ListingPatch) -> ListingOut:
    row = _own(db, seller.id, listing_id)
    fields = payload.model_fields_set
    if "title" in fields and payload.title is not None:
        title = _clean(payload.title, 300)
        if not title:
            raise _bad("empty_title")
        row.title = title
        row.work_key, _ = _link_work(db, seller.id, title, row.volume_key)
    if "author" in fields:
        row.author = _clean(payload.author, 200)
    if "price" in fields and payload.price is not None:
        row.price = payload.price
    if "condition" in fields and payload.condition:
        row.condition = payload.condition
    if "city" in fields:
        row.city = _clean(payload.city, 80)
    if "contact" in fields:
        row.contact = _phone(payload.contact)
    if "note" in fields:
        row.note = _clean(payload.note, 1000)
    if payload.remove_photo:
        row.photo = None
    elif "photo" in fields and payload.photo:
        row.photo = _check_photo(payload.photo)
    if "status" in fields and payload.status and payload.status != row.status:
        if payload.status in ("active", "reserved") and row.status not in ("active", "reserved"):
            active = db.execute(
                select(func.count()).where(BookListing.seller_id == seller.id, BookListing.status.in_(("active", "reserved")))
            ).scalar_one()
            if active >= MAX_ACTIVE:
                raise _bad("too_many_listings")
        row.status = payload.status
        row.sold_at = datetime.now(timezone.utc) if payload.status == "sold" else None
    db.commit()
    return listing(db, listing_id=row.id, viewer_id=seller.id)


def delete(db: Session, *, seller: User, listing_id: uuid.UUID) -> None:
    db.delete(_own(db, seller.id, listing_id))
    db.commit()


def photo(db: Session, *, listing_id: uuid.UUID) -> tuple[bytes, str]:
    row = db.get(BookListing, listing_id)
    if row is None or not row.photo or row.status == "hidden":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="photo_not_found")
    m = _DATA_URL.match(row.photo)
    if not m:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="photo_not_found")
    return base64.b64decode(m.group(2)), f"image/{m.group(1)}"
