from __future__ import annotations

import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.library import (
    BookcaseOut,
    CoverChoiceIn,
    CoverOptionOut,
    OverrideTextIn,
    FellowReaderOut,
    LibraryBookOut,
    LibraryBookUpdate,
    LibraryStatsOut,
    ProgressUpdate,
    ShelfBookOut,
)
from app.services import covers, shelf_overrides
from app.services.bookcase import BookcaseService
from app.services.library import LibraryService

router = APIRouter(prefix="/library", tags=["library"])


@router.get("/books", response_model=list[LibraryBookOut])
def list_books(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[LibraryBookOut]:
    return LibraryService(db).list_books(user_id=user.id)


@router.get("/stats", response_model=LibraryStatsOut)
def library_stats(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> LibraryStatsOut:
    return LibraryService(db).stats(user_id=user.id)


@router.post("/books", response_model=LibraryBookOut)
def upload_book(
    file: UploadFile = File(...),
    title: str | None = Form(default=None),
    author: str | None = Form(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> LibraryBookOut:
    return LibraryService(db).upload(user_id=user.id, file=file, title=title, author=author)


@router.get("/books/{book_id}/file")
def download_book(
    book_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> FileResponse:
    """Serve the file itself — owner only.

    Routed through the app rather than nginx precisely so this ownership
    check always runs; there is no public URL for an uploaded book.
    """
    path, book = LibraryService(db).file_path_for(book_id=book_id, user_id=user.id)
    media_type = "application/pdf" if book.file_format == "pdf" else "application/epub+zip"
    return FileResponse(path, media_type=media_type, filename=f"{book.title}.{book.file_format}")


@router.patch("/books/{book_id}", response_model=LibraryBookOut)
def update_book(
    book_id: uuid.UUID,
    payload: LibraryBookUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> LibraryBookOut:
    return LibraryService(db).update_book(
        book_id=book_id,
        user_id=user.id,
        title=payload.title,
        author=payload.author,
        cover_data=payload.cover_data,
        is_visible_to_buddies=payload.is_visible_to_buddies,
    )


@router.put("/books/{book_id}/progress", response_model=LibraryBookOut)
def save_progress(
    book_id: uuid.UUID,
    payload: ProgressUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> LibraryBookOut:
    return LibraryService(db).save_progress(
        book_id=book_id, user_id=user.id, percent=payload.percent, position=payload.position
    )


@router.delete("/books/{book_id}", status_code=204)
def delete_book(
    book_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    LibraryService(db).delete_book(book_id=book_id, user_id=user.id)


@router.get("/shelf/{owner_id}", response_model=list[ShelfBookOut])
def shelf_of(
    owner_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[ShelfBookOut]:
    """Another reader's shelf — metadata and progress only, never files."""
    return LibraryService(db).shelf_of(owner_id=owner_id, viewer_id=user.id)


def _bookcase(db: Session, owner_id: uuid.UUID, viewer_id: uuid.UUID, background: BackgroundTasks) -> BookcaseOut:
    service = BookcaseService(db)
    shelf = service.bookcase(owner_id=owner_id, viewer_id=viewer_id)
    # Covers not found yet are looked up after the response has gone out,
    # so a shelf never waits on Google; they show on the next visit.
    if service.pending_lookups:
        background.add_task(covers.fill_in_background, service.pending_lookups)
    return shelf


@router.get("/bookcase", response_model=BookcaseOut)
def my_bookcase(
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> BookcaseOut:
    """Everything finished plus everything uploaded, as one shelf."""
    return _bookcase(db, user.id, user.id, background)


@router.get("/bookcase/{owner_id}", response_model=BookcaseOut)
def bookcase_of(
    owner_id: uuid.UUID,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> BookcaseOut:
    """Another reader's shelf: finished books and visible uploads, never files."""
    return _bookcase(db, owner_id, user.id, background)


@router.get("/covers/{name}")
def cover_image(name: str) -> FileResponse:
    """A book cover found online and kept here.

    Deliberately public: it is a picture of a published book's cover, the
    same one any bookshop shows, and an <img> can't send a token anyway.
    Names change whenever the picture does, so browsers may keep it forever.
    """
    path = covers.resolve_image(name)
    if path is None:
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=31536000, immutable"})


@router.get("/fellow-readers", response_model=list[FellowReaderOut])
def fellow_readers(
    key: str = Query(min_length=3, max_length=300),
    owner_id: uuid.UUID = Query(),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[FellowReaderOut]:
    """Other PowerBook readers who finished the same book as a shelf's owner."""
    return BookcaseService(db).fellow_readers(key=key, owner_id=owner_id, viewer_id=user.id)


# ---------- a reader's corrections to their own shelf ----------


@router.get("/cover-search", response_model=list[CoverOptionOut])
def cover_search(
    q: str = Query(min_length=2, max_length=200),
    user: User = Depends(get_current_user),
) -> list[CoverOptionOut]:
    """Editions to choose a cover from; the reader picks the right one."""
    return [CoverOptionOut(**option) for option in shelf_overrides.search_editions(q)]


@router.put("/overrides/{volume_key}")
def set_override_text(
    volume_key: str,
    payload: OverrideTextIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Correct a book's title or author on your own shelf."""
    shelf_overrides.set_text(db, user.id, volume_key, payload.title, payload.author)
    return {"ok": True}


@router.put("/overrides/{volume_key}/cover")
def set_override_cover(
    volume_key: str,
    payload: CoverChoiceIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Take another edition's cover, go back to the painted one, or return
    to whatever was found automatically."""
    if payload.mode == "pick":
        shelf_overrides.pick(db, user.id, volume_key, payload.source or "", payload.volume_id or "")
    else:
        shelf_overrides.set_mode(db, user.id, volume_key, payload.mode)
    return {"ok": True}


@router.post("/overrides/{volume_key}/photo")
async def set_override_photo(
    volume_key: str,
    photo: UploadFile = File(...),
    thumb: UploadFile | None = File(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """A photo of your own copy as the cover."""
    await shelf_overrides.upload_photo(db, user.id, volume_key, photo, thumb)
    return {"ok": True}


@router.delete("/overrides/{volume_key}")
def reset_override(
    volume_key: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Forget every correction to this book."""
    shelf_overrides.reset(db, user.id, volume_key)
    return {"ok": True}
