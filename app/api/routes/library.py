from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.library import (
    LibraryBookOut,
    LibraryBookUpdate,
    LibraryStatsOut,
    ProgressUpdate,
    ShelfBookOut,
)
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
