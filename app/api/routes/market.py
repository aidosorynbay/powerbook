from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.books import ListingIn, ListingOut, ListingPatch, MarketPageOut
from app.services import market

router = APIRouter(prefix="/market", tags=["market"])


@router.get("", response_model=MarketPageOut)
def market_page(
    q: str = Query(default="", max_length=120),
    city: str | None = Query(default=None, max_length=80),
    sort: str = Query(default="new", pattern="^(new|cheap|dear)$"),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=48, ge=1, le=120),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MarketPageOut:
    return market.market_page(db, viewer_id=user.id, q=q, city=city, sort=sort, offset=offset, limit=limit)


@router.post("", response_model=ListingOut, status_code=status.HTTP_201_CREATED)
def create_listing(
    payload: ListingIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ListingOut:
    return market.create(db, seller=user, payload=payload)


@router.get("/user/{user_id}", response_model=list[ListingOut])
def user_listings(
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[ListingOut]:
    return market.listings_for_user(db, seller_id=user_id, viewer_id=user.id)


@router.get("/{listing_id}/photo")
def listing_photo(listing_id: uuid.UUID, db: Session = Depends(get_db)) -> Response:
    """The seller's photo of their copy. Open like the covers are: an <img>
    carries no token, and a listing's id is not guessable."""
    data, media_type = market.photo(db, listing_id=listing_id)
    return Response(content=data, media_type=media_type, headers={"Cache-Control": "public, max-age=604800"})


@router.get("/{listing_id}", response_model=ListingOut)
def get_listing(
    listing_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ListingOut:
    return market.listing(db, listing_id=listing_id, viewer_id=user.id)


@router.patch("/{listing_id}", response_model=ListingOut)
def update_listing(
    listing_id: uuid.UUID,
    payload: ListingPatch,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ListingOut:
    return market.update(db, seller=user, listing_id=listing_id, payload=payload)


@router.delete("/{listing_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_listing(
    listing_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    market.delete(db, seller=user, listing_id=listing_id)
