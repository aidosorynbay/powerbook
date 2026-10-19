"""One book, one face: how a book of the shared library looks wherever PowerBook shows it.

The shared library (app.services.catalog) decides, for each book, its title in each alphabet its copies are
written in, its author (app.core.authors) and its cover. Everything that shows a book shows that face — a
reader's shelf, the library's card, the Round's «Сегодня» line, a story sticker — and not the cover inside a
reader's file, nor the picture the lookup of one reader's spelling happened to find. «Три товарища» had one
cover on the library's card and another on the founder's shelf, and two different authors on different
shelves (2026-10-15).

Only what a reader chose for their own copy stays theirs, on that copy: a title or an author typed in, a
cover photographed, the painted edition. A cover a reader picked from the catalogues becomes the book's cover
for everyone, since a person's choice outranks any number of lookups (the most picked, if readers disagree);
a photo stays on its shelf, unless the book has no cover at all: then it is the book's cover for everyone. A copy that spells the same words differently («три товарища!!») takes the library's spelling; a
different title — a volume number, a translation, the same words in Latin letters — keeps its own cover.
"""
from __future__ import annotations

from dataclasses import dataclass

from app.services import catalog


def cover_urls(image: str | None) -> tuple[str | None, str | None]:
    """(full, small) addresses of a stored cover."""
    if not image:
        return None, None
    return f"/library/covers/{image}.jpg", f"/library/covers/{image}-s.jpg"


@dataclass
class Face:
    title: str
    author: str | None
    image: str | None
    # the Google Books page of that cover's edition
    link: str | None

    @property
    def cover_url(self) -> str | None:
        return cover_urls(self.image)[0]

    @property
    def cover_thumb_url(self) -> str | None:
        return cover_urls(self.image)[1]


def work_of(idx: catalog.CatalogIndex, *keys: str | None, title: str | None = None) -> catalog.Work | None:
    """The book of the shared library behind any of these comparison keys, or behind a title as typed."""
    for key in keys:
        work = idx.find(key)
        if work is not None:
            return work
    if title:
        from app.core.booktitles import matching_key

        for key in (matching_key(title), catalog.work_key(title)):
            work = idx.find(key)
            if work is not None:
                return work
    return None


def face(work: catalog.Work, title: str | None = None) -> Face:
    """The face of `work` for a copy titled `title`, or the book's own."""
    shown = title or work.title
    own_title, image = work.faces.get(catalog.face_key(shown), (None, None))
    if own_title:
        shown = own_title
    image = image or work.image
    return Face(title=shown, author=work.author, image=image, link=work.cover_links.get(image or "") or work.source_url)


def of_title(idx: catalog.CatalogIndex, title: str) -> Face | None:
    """The face of the book a typed title names, when the shared library knows it."""
    work = work_of(idx, title=title)
    return face(work, title) if work is not None else None


def spelling(idx: catalog.CatalogIndex, title: str | None) -> str | None:
    """How the shared library writes a typed title: «три товарища!!» is «Три товарища» on every shelf, so it is
    in the reading room and on a sticker too. Words the library doesn't know as a book stay as typed."""
    if not title or not title.strip():
        return title
    work = work_of(idx, title=title)
    own = work.faces.get(catalog.face_key(title)) if work is not None else None
    return own[0] if own else title.strip()


def dress(vol, work: catalog.Work, override=None) -> None:
    """A shelf copy (BookcaseBookOut) in the library's face, but for what its reader chose for it.

    A pinned copy («Какая это книга?») kept the title and author the library had when it was pinned: they
    are no word of the reader's own, and follow the library since."""
    pinned = override is not None and bool(override.work_key)
    typed_title = override is not None and bool(override.title) and not pinned
    typed_author = override is not None and bool(override.author) and not pinned
    chose_cover = override is not None and override.cover_mode in ("image", "none")

    # the book's key paints a cover-less copy in the same colours as the library's card
    vol.work_key = work.key
    own_title, image = work.faces.get(catalog.face_key(vol.title), (None, None))
    if own_title and not typed_title:
        vol.title = own_title
    if work.author and not typed_author:
        vol.author = work.author
    if chose_cover:
        return
    # Another title's edition (a translation's, another volume's) only for a copy with no picture at all: a
    # Kazakh file's own cover beats the Russian edition of the same book.
    if image is None and not (vol.cover_url or vol.cover_data):
        image = work.image
    if image:
        vol.cover_url, vol.cover_thumb_url = cover_urls(image)
        vol.cover_data = None
        vol.source_url = work.cover_links.get(image)
