"""/admin → «Книги: склейка»: making two books of the shared library one.

Readers' shelves spell books every way there is, and the shared library
joins what is plainly the same title. What it cannot see is a translation
and its original («Атомные привычки» and "Atomic Habits"), or an edition
sold under another title. Here the founder finds such books, by search or
in the list of likely doubles, and says they are one: a book link
(app/models/book_link.py), which the shared library follows from then on.
Marks, readers and listings of both count for the one book.

Here too the founder says who wrote a book when the sources got it wrong
(app/models/book_author.py): the book's card and every shelf holding it
show that name, and the list «Автор под вопросом» brings up the books whose
sources name different people.
"""
from __future__ import annotations

import inspect
import re
import uuid
from collections import defaultdict
from difflib import SequenceMatcher
from urllib.parse import quote

from sqladmin import BaseView, ModelView, expose
from sqlalchemy import delete, select, update
from starlette.requests import Request
from starlette.responses import RedirectResponse

from app.core.booktitles import match_key
from app.db.session import get_session_factory
from app.models.book_author import BookAuthor
from app.models.book_cover import BookCover
from app.models.book_link import BookLink
from app.models.book_review import BookReview
from app.services import catalog

_DOUBLES = 60
_DISPUTES = 60


def _row(work, votes: dict[str, int]) -> dict:
    return {
        "key": work.key,
        "title": work.title,
        "author": work.author or "",
        "readers": len(work.readers),
        "votes": votes.get(work.key, 0),
        "image": work.image,
        "author_fixed": work.author_fixed,
        # the other people the sources name, with the weight of what named them
        "rivals": [{"name": name, "weight": weight} for name, weight in work.author_rivals[1:4]],
    }


def author_disputes(idx, votes: dict[str, int]) -> list[dict]:
    """Books whose sources name more than one person as the author, for real:
    a catalogue's lookup or a reader's known author name against another,
    not a reader's «Перечитала» after the title."""
    works = [
        w for w in idx.works.values()
        if not w.author_fixed and len(w.author_rivals) > 1 and w.author_rivals[1][1] >= 0.75
    ]
    works.sort(key=lambda w: (-len(w.readers), w.title.casefold()))
    return [_row(w, votes) for w in works[:_DISPUTES]]


def set_author(db, key: str, author: str | None, admin_id: uuid.UUID | None) -> bool:
    """The founder's word on who wrote a book; an empty name gives the choice
    back to the sources. The book's lookups are asked again with the name,
    so their covers become editions by that author (covers.recheck_disputed)."""
    work = catalog.index(db).find(key)
    if work is None:
        return False
    name = re.sub(r"\s+", " ", author or "").strip(" ,;")[:200]
    # One word per book, whichever of its keys an earlier one was kept under.
    db.execute(delete(BookAuthor).where(BookAuthor.key.in_(sorted(work.members))))
    if name:
        db.add(BookAuthor(key=work.key, author=name, title=work.title[:300], created_by=admin_id))
        if work.cover_keys:
            db.execute(update(BookCover).where(BookCover.key.in_(sorted(work.cover_keys))).values(author_checked_at=None))
    db.commit()
    catalog.invalidate()
    return True


def _votes(db, idx) -> dict[str, int]:
    out: dict[str, int] = defaultdict(int)
    for (key,) in db.execute(select(BookReview.work_key)).all():
        work = idx.find(key)
        if work is not None:
            out[work.key] += 1
    return out


def likely_doubles(idx, votes: dict[str, int]) -> list[tuple[dict, dict]]:
    """Pairs of books that look like one: the same author and a title that
    contains the other or nearly is it; or, without an author, titles that
    start alike and nearly are each other."""
    works = list(idx.works.values())
    by_author: dict[str, list] = defaultdict(list)
    by_head: dict[str, list] = defaultdict(list)
    for w in works:
        a = match_key(w.author or "")
        if len(a) >= 4:
            by_author[a].append(w)
        t = match_key(w.title)
        if len(t) >= 6:
            by_head[t[:6]].append(w)

    seen: set[tuple[str, str]] = set()
    pairs: list[tuple[float, object, object]] = []

    def consider(a, b, strict: bool) -> None:
        key = tuple(sorted((a.key, b.key)))
        if a.key == b.key or key in seen:
            return
        ta, tb = match_key(a.title), match_key(b.title)
        if not ta or not tb:
            return
        contains = min(len(ta), len(tb)) >= 5 and (ta in tb or tb in ta)
        ratio = SequenceMatcher(None, ta, tb).ratio()
        if contains and not strict or ratio >= (0.92 if strict else 0.8):
            seen.add(key)
            pairs.append((max(ratio, 0.9 if contains else 0), a, b))

    for group in by_author.values():
        if 1 < len(group) <= 40:
            for i, a in enumerate(group):
                for b in group[i + 1:]:
                    consider(a, b, strict=False)
    for group in by_head.values():
        if 1 < len(group) <= 40:
            for i, a in enumerate(group):
                for b in group[i + 1:]:
                    consider(a, b, strict=True)

    pairs.sort(key=lambda p: (-(len(p[1].readers) + len(p[2].readers)), -p[0]))
    return [(_row(a, votes), _row(b, votes)) for _s, a, b in pairs[:_DOUBLES]]


def link(db, keys: list[str], admin_id: uuid.UUID | None) -> int:
    """Join every book in `keys` to the first. Returns how many links were made. Two volumes of a series or two
    authors are never one book (book_identity.why_apart): ValueError with the reason, and nothing is joined."""
    from app.services.book_identity import why_apart

    idx = catalog.index(db)
    works = [idx.find(k) for k in keys]
    works = [w for w in works if w is not None]
    if len(works) < 2:
        return 0
    first, made = works[0], 0
    for other in works[1:]:
        if other.key != first.key:
            reason = why_apart(first.title, first.author, other.title, other.author)
            if reason:
                raise ValueError(f"«{first.title}» и «{other.title}»: {reason}")
    for other in works[1:]:
        if other.key == first.key:
            continue
        a, b = sorted((first.key, other.key))
        exists = db.execute(select(BookLink).where(BookLink.key_a == a, BookLink.key_b == b)).scalar_one_or_none()
        if exists is None:
            title = {first.key: first.title, other.key: other.title}
            db.add(BookLink(key_a=a, key_b=b, title_a=title[a][:300], title_b=title[b][:300], created_by=admin_id))
            made += 1
    db.commit()
    catalog.invalidate()
    return made


class BookMergeView(BaseView):
    name = "Книги: склейка"
    identity = "book-merge"
    icon = "fa-solid fa-object-group"

    @expose("/book-merge", methods=["GET"])
    async def page(self, request: Request):
        q = (request.query_params.get("q") or "").strip()[:120]
        db = get_session_factory()()
        try:
            idx = catalog.index(db)
            votes = _votes(db, idx)
            found = []
            if len(q) >= 2:
                found = [w for w in idx.works.values() if catalog.search_matches(w, q)]
                found.sort(key=lambda w: (-len(w.readers), w.title.casefold()))
                found = [_row(w, votes) for w in found[:60]]
            from app.services.book_identity import candidates

            # without the pairs already answered and those that may never be one (book_identity)
            doubles = candidates(db, idx) if not q else []
            disputes = author_disputes(idx, votes) if not q else []
            links = db.execute(select(BookLink).order_by(BookLink.created_at.desc()).limit(100)).scalars().all()
            link_rows = [{"id": str(x.id), "a": x.title_a or x.key_a, "b": x.title_b or x.key_b} for x in links]
        finally:
            db.close()
        context = {
            "title": "Книги: склейка",
            "subtitle": "Одна книга в общей библиотеке — одна карточка, один автор и общие оценки",
            "q": q,
            "found": found,
            "doubles": doubles,
            "disputes": disputes,
            "links": link_rows,
            "base": str(request.url_for("admin:index")).rstrip("/"),
            "msg": request.query_params.get("msg", ""),
        }
        response = self.templates.TemplateResponse(request, "book_merge.html", context)
        if inspect.isawaitable(response):
            response = await response
        return response

    @expose("/book-merge/link", methods=["POST"])
    async def merge(self, request: Request):
        form = await request.form()
        keys = [str(k) for k in form.getlist("key") if k]
        back = str(form.get("back") or "")
        base = str(request.url_for("admin:index")).rstrip("/")
        admin = request.session.get("admin_user")
        db = get_session_factory()()
        refused = None
        try:
            made = link(db, keys, uuid.UUID(admin) if admin else None)
        except ValueError as exc:
            made, refused = 0, str(exc)
        finally:
            db.close()
        if refused:
            msg = f"Не склеено: {refused}"
        else:
            msg = f"Склеено: {made}" if made else "Нечего склеивать — выберите хотя бы две разные книги"
        q = f"&q={quote(back)}" if back else ""
        return RedirectResponse(f"{base}/book-merge?msg={quote(msg)}{q}", status_code=303)

    @expose("/book-merge/author", methods=["POST"])
    async def author(self, request: Request):
        form = await request.form()
        key = str(form.get("key") or "")
        back = str(form.get("back") or "")
        base = str(request.url_for("admin:index")).rstrip("/")
        admin = request.session.get("admin_user")
        name = str(form.get("author") or "")
        db = get_session_factory()()
        try:
            done = set_author(db, key, name, uuid.UUID(admin) if admin else None)
        finally:
            db.close()
        if not done:
            msg = "Книга не найдена"
        elif name.strip():
            msg = f"Автор сохранён: {name.strip()[:200]}"
        else:
            msg = "Автор снова по источникам"
        q = f"&q={quote(back)}" if back else ""
        return RedirectResponse(f"{base}/book-merge?msg={quote(msg)}{q}", status_code=303)

    @expose("/book-merge/apart", methods=["POST"])
    async def apart(self, request: Request):
        """«Разные»: the pair leaves the list of likely doubles for good."""
        from app.services.book_identity import mark_apart

        form = await request.form()
        keys = [str(k) for k in form.getlist("key") if k]
        base = str(request.url_for("admin:index")).rstrip("/")
        admin = request.session.get("admin_user")
        db = get_session_factory()()
        try:
            done = len(keys) == 2 and mark_apart(db, keys[0], keys[1], uuid.UUID(admin) if admin else None)
        finally:
            db.close()
        msg = "Отмечено: разные книги — больше не покажем" if done else "Не нашлось этих книг"
        return RedirectResponse(f"{base}/book-merge?msg={quote(msg)}", status_code=303)

    @expose("/book-merge/unlink", methods=["POST"])
    async def unlink(self, request: Request):
        form = await request.form()
        base = str(request.url_for("admin:index")).rstrip("/")
        db = get_session_factory()()
        try:
            row = db.get(BookLink, uuid.UUID(str(form.get("id"))))
            if row is not None:
                db.delete(row)
                db.commit()
                catalog.invalidate()
        finally:
            db.close()
        return RedirectResponse(f"{base}/book-merge?msg={quote('Склейка снята')}", status_code=303)


class BookLinkAdmin(ModelView, model=BookLink):
    """Every «это одна книга» the founder said; deleting one undoes it."""

    column_list = [BookLink.title_a, BookLink.title_b, BookLink.key_a, BookLink.key_b, BookLink.created_at]
    column_default_sort = [(BookLink.created_at, True)]
    can_create = False
    can_edit = False
    name = "Book Link"
    name_plural = "Book Links"
    icon = "fa-solid fa-link"
