"""One book, one face: a book of the shared library looks the same on its card and on every shelf — the
founder saw «Три товарища» with one cover on the library's card and another on their own shelf
(2026-10-15). Only what a reader chose for their own copy stays theirs."""
from __future__ import annotations

import re
import uuid
from datetime import date
from pathlib import Path

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.base import Base
from app.models.book_cover import BookCover
from app.models.enums import Gender, RoundStatus
from app.models.group import Group
from app.models.library import LibraryBook
from app.models.round import ReadingLog, Round
from app.models.shelf_override import ShelfOverride
from app.models.user import User
from app.repositories.insights import normalize_book_title
from app.services import book_face, catalog, covers
from app.services.bookcase import BookcaseService, _short_hash

CAR, BLUE, PICK, PHOTO = "c" * 32, "b" * 32, "d" * 32, "e" * 32


@pytest.fixture()
def env():
    catalog.invalidate()
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def _fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False, autocommit=False)()

    def user(name):
        u = User(username=name, display_name=name.title(), password_hash="x", gender=Gender.female)
        db.add(u)
        db.flush()
        return u

    madik, uldai, gumi, orken = user("madik"), user("uldai"), user("gumi"), user("orken")
    group = Group(name="PowerBook", slug="powerbook", owner_user_id=madik.id)
    db.add(group)
    db.flush()
    rnd = Round(group_id=group.id, year=2026, month=9, status=RoundStatus.locked, end_day=None)
    db.add(rnd)
    db.flush()

    def finished(u, day, comment):
        db.add(ReadingLog(round_id=rnd.id, user_id=u.id, date=date(2026, 9, day), minutes=40, score=0,
                          comment=comment, book_finished=True))

    def cover(title, image, author="Эрих Мария Ремарк", fixed=None, edition=None):
        db.add(BookCover(key=covers.cover_key(title), query=title, status="found", title=fixed, author=author,
                         source="google", source_id=edition or f"G-{image[:4]}", image=image))

    # Two readers wrote «Три товарища», one the author after it (its own lookup, another edition), one the
    # title in lower case with relief (the first lookup).
    finished(uldai, 3, "Три товарища")
    finished(gumi, 4, "Три товарища")
    finished(madik, 5, "Три товарища Ремарк")
    finished(orken, 6, "три товарища!!")
    cover("Три товарища", CAR)
    cover("Три товарища Ремарк", BLUE, fixed="Три товарища")
    db.commit()

    def shelf(u):
        return {b.title: b for b in BookcaseService(db).bookcase(owner_id=u.id, viewer_id=u.id).books}

    yield type("Env", (), dict(db=db, madik=madik, uldai=uldai, gumi=gumi, orken=orken, finished=finished, cover=cover,
                               shelf=shelf, rnd=rnd))
    db.close()
    catalog.invalidate()


def _work(db, title):
    return catalog.index(db).find(catalog.work_key(title))


def _vol(comment):
    return f"r:{_short_hash(normalize_book_title(comment))}"


def test_every_shelf_shows_the_cover_on_the_librarys_card(env):
    work = _work(env.db, "Три товарища")
    assert work.image == CAR and work.faces[catalog.face_key("три товарища!!")] == ("Три товарища", CAR)
    for reader in (env.uldai, env.gumi, env.madik, env.orken):
        vol = env.shelf(reader)["Три товарища"]
        assert vol.cover_url == f"/library/covers/{CAR}.jpg", reader.username
        assert vol.cover_thumb_url == f"/library/covers/{CAR}-s.jpg"
    assert book_face.face(work).cover_url == f"/library/covers/{CAR}.jpg"


def test_the_cover_inside_a_readers_file_gives_way_to_the_librarys(env):
    env.db.add(LibraryBook(user_id=env.uldai.id, title="Три товарища", file_format="epub",
                           file_key=f"{env.uldai.id}/{uuid.uuid4()}.epub", file_size=10,
                           cover_data="data:image/jpeg;base64,AAAA"))
    env.db.commit()
    vol = env.shelf(env.uldai)["Три товарища"]
    assert vol.has_file and vol.cover_data is None and vol.cover_url == f"/library/covers/{CAR}.jpg"


def test_a_file_of_a_book_the_library_has_no_cover_for_keeps_its_own(env):
    env.db.add(LibraryBook(user_id=env.orken.id, title="Редкая книга", file_format="epub",
                           file_key=f"{env.orken.id}/{uuid.uuid4()}.epub", file_size=10,
                           cover_data="data:image/jpeg;base64,AAAA"))
    env.db.commit()
    assert env.shelf(env.orken)["Редкая книга"].cover_data == "data:image/jpeg;base64,AAAA"


def test_the_same_words_take_the_librarys_spelling_other_words_keep_theirs(env):
    env.finished(env.orken, 11, "Граф Монте-Кристо 2")
    env.finished(env.uldai, 7, "Граф Монте-Кристо")
    env.cover("Граф Монте-Кристо", "9" * 32, author="Александр Дюма")
    # Orken said the second volume is that book («Какая это книга?»).
    env.db.add(ShelfOverride(user_id=env.orken.id, volume_key=_vol("Граф Монте-Кристо 2"), cover_mode="auto",
                             work_key=catalog.work_key("Граф Монте-Кристо")))
    env.db.commit()
    catalog.invalidate()
    assert "Три товарища" in env.shelf(env.orken) and "три товарища" not in env.shelf(env.orken)
    second = env.shelf(env.orken)["Граф Монте-Кристо 2"]
    assert second.author == "Александр Дюма" and second.cover_url == f"/library/covers/{'9' * 32}.jpg"


def test_a_cover_a_reader_picked_becomes_the_books_cover(env):
    env.db.add(ShelfOverride(user_id=env.madik.id, volume_key=_vol("Три товарища Ремарк"), cover_mode="image",
                             image=PICK, source="google", source_id="P1"))
    env.db.commit()
    catalog.invalidate()
    # One person's pick outranks three readers' lookups of one edition: everyone's copy and the card show it.
    assert _work(env.db, "Три товарища").image == PICK
    for reader in (env.madik, env.uldai, env.gumi, env.orken):
        assert env.shelf(reader)["Три товарища"].cover_url == f"/library/covers/{PICK}.jpg", reader.username
    # Readers who disagree: the most picked, and each picker keeps their own.
    other = "7" * 32
    for reader in (env.gumi, env.uldai):
        env.db.add(ShelfOverride(user_id=reader.id, volume_key=_vol("Три товарища"), cover_mode="image",
                                 image=other, source="openlibrary", source_id="O1"))
    env.db.commit()
    catalog.invalidate()
    assert _work(env.db, "Три товарища").image == other
    assert env.shelf(env.madik)["Три товарища"].cover_url == f"/library/covers/{PICK}.jpg"
    assert env.shelf(env.orken)["Три товарища"].cover_url == f"/library/covers/{other}.jpg"


def test_a_photo_stays_on_its_shelf_alone(env):
    env.db.add(ShelfOverride(user_id=env.madik.id, volume_key=_vol("Три товарища Ремарк"), cover_mode="image",
                             image=PHOTO, source="photo"))
    env.db.add(ShelfOverride(user_id=env.gumi.id, volume_key=_vol("Три товарища"), cover_mode="none"))
    env.db.commit()
    catalog.invalidate()
    assert env.shelf(env.madik)["Три товарища"].cover_url == f"/library/covers/{PHOTO}.jpg"
    assert env.shelf(env.gumi)["Три товарища"].cover_url is None
    assert _work(env.db, "Три товарища").image == CAR


def test_each_alphabet_keeps_its_own_edition(env):
    env.finished(env.orken, 12, "Atomic Habits")
    env.finished(env.uldai, 13, "Атомные привычки")
    env.finished(env.gumi, 14, "Атомные привычки")
    env.cover("Atomic Habits", "a" * 32, author="James Clear")
    env.cover("Атомные привычки", "f" * 32, author="Джеймс Клир")
    env.db.commit()
    catalog.invalidate()
    work = _work(env.db, "Атомные привычки")
    assert work.title == "Атомные привычки" and work.image == "f" * 32
    assert env.shelf(env.orken)["Atomic Habits"].cover_url == f"/library/covers/{'a' * 32}.jpg"
    assert env.shelf(env.uldai)["Атомные привычки"].cover_url == f"/library/covers/{'f' * 32}.jpg"


def test_a_reader_typed_title_stays_theirs(env):
    env.db.add(ShelfOverride(user_id=env.orken.id, volume_key=_vol("три товарища!!"), cover_mode="auto",
                             title="три товарища (моё издание)"))
    env.db.commit()
    assert "три товарища (моё издание)" in env.shelf(env.orken)


def test_a_translation_in_the_same_letters_keeps_its_own_edition(env):
    from app.models.book_link import BookLink

    env.finished(env.orken, 15, "Абай жолы")
    env.finished(env.uldai, 16, "Путь Абая")
    env.finished(env.gumi, 17, "Путь Абая")
    env.cover("Абай жолы", "1" * 32, author="Мұхтар Әуезов")
    env.cover("Путь Абая", "2" * 32, author="Мухтар Ауэзов")
    # The founder said they are one book.
    env.db.add(BookLink(key_a=catalog.work_key("Абай жолы"), key_b=catalog.work_key("Путь Абая")))
    env.db.commit()
    catalog.invalidate()
    work = _work(env.db, "Абай жолы")
    assert work.key == _work(env.db, "Путь Абая").key and work.image == "2" * 32
    assert env.shelf(env.orken)["Абай жолы"].cover_url == f"/library/covers/{'1' * 32}.jpg"
    assert env.shelf(env.uldai)["Путь Абая"].cover_url == f"/library/covers/{'2' * 32}.jpg"


def test_a_typed_title_is_spelled_as_the_library_spells_it(env):
    idx = catalog.index(env.db)
    assert book_face.spelling(idx, "три товарища!!") == "Три товарища"
    assert book_face.spelling(idx, "Книга, которой нет") == "Книга, которой нет"
    assert book_face.spelling(idx, "") == ""


def test_the_reading_room_and_the_sticker_spell_it_the_same(env):
    from app.models.reading_room import ReadingRoomSession
    from app.services import day_share
    from app.services.reading_room import ReadingRoomService

    room = ReadingRoomService(env.db)
    assert room._shown("три товарища") == "Три товарища"
    env.db.add(ReadingRoomSession(user_id=env.orken.id, hall="library", seat=1, book_title="три товарища",
                                  credited_round_id=env.rnd.id, credited_date=date(2026, 9, 20), credited_minutes=30))
    env.db.commit()
    assert day_share._book(env.db, user=env.orken, rnd=env.rnd, day=date(2026, 9, 21)) == "Три товарища"


def test_a_profiles_reading_now_shows_the_librarys_face(env):
    from app.services.library import LibraryService

    env.db.add(LibraryBook(user_id=env.orken.id, title="три товарища", file_format="epub", is_visible_to_buddies=True,
                           file_key=f"{env.orken.id}/{uuid.uuid4()}.epub", file_size=10, progress_percent=40,
                           cover_data="data:image/jpeg;base64,AAAA"))
    env.db.add(LibraryBook(user_id=env.orken.id, title="Редкая книга", file_format="pdf", is_visible_to_buddies=True,
                           file_key=f"{env.orken.id}/{uuid.uuid4()}.pdf", file_size=10, progress_percent=10,
                           cover_data="data:image/jpeg;base64,BBBB"))
    env.db.commit()
    shelf = {b.title: b for b in LibraryService(env.db).shelf_of(owner_id=env.orken.id, viewer_id=env.uldai.id)}
    assert shelf["Три товарища"].cover_url == f"/library/covers/{CAR}.jpg" and shelf["Три товарища"].cover_data is None
    assert shelf["Три товарища"].author == "Эрих Мария Ремарк"
    assert shelf["Редкая книга"].cover_url is None and shelf["Редкая книга"].cover_data == "data:image/jpeg;base64,BBBB"


def test_other_people_see_titles_not_comments_and_no_private_books(env):
    from app.services.insights import InsightsService

    env.db.add(ReadingLog(round_id=env.rnd.id, user_id=env.orken.id, date=date(2026, 9, 25), minutes=40, score=0,
                          comment="«Тайный дневник» — никому не показывать", book_finished=True, is_comment_private=True))
    env.db.add(ReadingLog(round_id=env.rnd.id, user_id=env.orken.id, date=date(2026, 9, 26), minutes=40, score=0,
                          comment="«Мартин Иден» Джек Лондон\nПлакал весь вечер", book_finished=True))
    env.db.commit()
    catalog.invalidate()
    public = [b.title for b in InsightsService(env.db).bookshelf(user_id=env.orken.id, public=True)]
    assert public[0] == "Мартин Иден" and "Тайный дневник" not in public
    assert all("\n" not in t and "Плакал" not in t for t in public)
    assert "Тайный дневник" in [b.title for b in InsightsService(env.db).bookshelf(user_id=env.orken.id)]


def test_only_the_shared_library_decides_how_a_book_looks():
    """The guard. A place that shows a book takes its face from app.services.book_face — never from the cover
    lookup of one reader's spelling (book_covers), which is how «Три товарища» came to look one way on the
    library's card and another on a shelf. These modules may read the lookups: they build the faces, keep the
    lookups, or need an edition itself (ratings, a top-3 title the library doesn't know)."""
    root = Path(__file__).resolve().parents[1]
    allowed = {
        "app/services/catalog.py", "app/services/bookcase.py", "app/services/covers.py",
        "app/services/book_facts.py", "app/services/social.py",
    }
    offenders = sorted(
        path.relative_to(root).as_posix()
        for path in (root / "app").rglob("*.py")
        if re.search(r"covers\.cached\(|select\(BookCover\b", path.read_text(encoding="utf-8"))
        and path.relative_to(root).as_posix() not in allowed
    )
    assert offenders == [], f"show a book through app.services.book_face, not book_covers: {offenders}"

    # A cover-less book is painted from its key in the shared library, as the 3D shelf paints it, so it has the
    # same colours everywhere.
    for path in (root / "frontend" / "src").rglob("*.tsx"):
        text = path.read_text(encoding="utf-8")
        for start in [m.start() for m in re.finditer(r"<BookFace\b", text)]:
            end = min(i for i in (text.find("/>", start), text.find(">\n", start), len(text)) if i >= 0)
            assert "seed=" in text[start:end], f"{path.relative_to(root)}: a BookFace without seed= (the book's key)"


def test_popular_books_name_titles_only_and_leave_private_books_out(env):
    from app.repositories.insights import InsightsRepository

    env.db.add(ReadingLog(round_id=env.rnd.id, user_id=env.orken.id, date=date(2026, 9, 27), minutes=40, score=0,
                          comment="«Тайный дневник» — никому", book_finished=True, is_comment_private=True))
    env.db.add(ReadingLog(round_id=env.rnd.id, user_id=env.orken.id, date=date(2026, 9, 28), minutes=40, score=0,
                          comment="«Мартин Иден»\nПлакал весь вечер", book_finished=True))
    env.db.commit()
    titles = [t for t, _ in InsightsRepository(env.db).popular_books(limit=20)]
    assert "Мартин Иден" in titles and not any("Тайный" in t or "Плакал" in t for t in titles)
