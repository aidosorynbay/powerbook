"""Covers from Flip.kz, for the Kazakh and local editions no world catalogue holds."""
import urllib.error

import pytest

from app.models.book_cover import BookCover
from app.services import covers, covers_ai

_ITEM = (
    '<div class="new-product "><a href="/catalog?prod={id}" class="product"><div class="top"><div class="product-image">'
    '<div class="img-to-scroll"><img class="image" loading="lazy" src="//s.f.kz/prod/{k}/{id}_550.jpg" alt="{title}"/>'
    '</div></div></div><div class="product-data"><div class="title">{title}</div>'
    '<div class="description"><span>{kind}</span><span>Фолиант</span></div></div></a></div>'
)
SEARCH = "".join(
    [
        _ITEM.format(id=4306625, k=4307, title="Гауһар тас", kind="твердый переплет, 2023"),
        _ITEM.format(id=5068000, k=5068, title="Гауһар тас", kind="пазл, 1000 деталей"),
        _ITEM.format(id=1791376, k=1792, title="Алтын адам", kind="мягкая обложка, 2019"),
    ]
)
PAGE = (
    '<div class="top-line title">Авторы</div><p><a href="/descript?cat=people&id=140608"><b>Дулат Исабеков</b></a>, '
    '<a href="/descript?cat=people&id=140608">все товары</a></p>'
)


@pytest.fixture()
def flip(monkeypatch):
    asked: list[str] = []

    def paced(url):
        asked.append(url)
        return (PAGE if "catalog?prod=" in url else SEARCH).encode()

    monkeypatch.setattr(covers, "_paced", paced)
    return asked


def test_books_only_and_the_close_ones_get_their_author(flip):
    found = covers._search_flip("Гауһар тас")
    # The puzzle has no binding: not a book.
    assert [c.volume_id for c in found] == ["4306625", "1791376"]
    assert found[0].creators == ["Дулат Исабеков"] and found[0].source == "flip"
    # Only the book whose name is close was opened.
    assert [u for u in flip if "prod=" in u] == ["https://www.flip.kz/catalog?prod=4306625"]


def test_the_picture_is_filed_by_the_thousand():
    assert covers._flip_image("4306625", 1000) == "https://s.f.kz/prod/4307/4306625_1000.jpg"
    assert covers._flip_image("5068000", 550) == "https://s.f.kz/prod/5068/5068000_550.jpg"


@pytest.fixture()
def google_down(monkeypatch, tmp_path):
    def refuse(q):
        raise urllib.error.HTTPError("https://www.google.com/books/feeds/volumes", 500, "down", {}, None)

    monkeypatch.setattr(covers, "COVERS_DIR", tmp_path)
    monkeypatch.setattr(covers, "_search", refuse)
    monkeypatch.setattr(covers, "_wikidata_cover", lambda q: None)
    monkeypatch.setattr(covers, "_fetch_images", lambda c, min_width=250: (b"full", b"small"))


def _look_up(query):
    row = BookCover(key=covers.cover_key(query), query=query, status="working", attempts=0)
    covers._look_up(row, None)
    return row


def test_google_down_does_not_stop_the_shop_being_asked(google_down, monkeypatch):
    book = covers._Candidate(volume_id="4306625", titles=["Гауһар тас"], creators=["Дулат Исабеков"],
                             has_thumbnail=True, source="flip")
    monkeypatch.setattr(covers, "_search_flip", lambda q: [book])
    row = _look_up("Гауһар тас")
    assert row.status == "found" and row.source == "flip" and row.image
    assert row.author == "Дулат Исабеков"


def test_google_down_and_nothing_elsewhere_is_tried_again_tomorrow(google_down, monkeypatch):
    monkeypatch.setattr(covers, "_search_flip", lambda q: [])
    with pytest.raises(urllib.error.HTTPError):
        _look_up("Гауһар тас")


def test_flip_only_asks_no_one_else(google_down, monkeypatch):
    """The Flip-only sweep spends no Google quota and asks no Wikipedia or Claude."""
    asked = []
    monkeypatch.setattr(covers, "_search", lambda q: asked.append("google") or [])
    monkeypatch.setattr(covers, "_search_open_library", lambda q: asked.append("openlibrary") or [])
    monkeypatch.setattr(covers, "_wikidata_cover", lambda q: asked.append("wikidata") or None)
    monkeypatch.setattr(covers_ai, "find_cover", lambda q, a: asked.append("claude") or None)
    book = covers._Candidate(volume_id="4306625", titles=["Гауһар тас"], creators=["Дулат Исабеков"],
                             has_thumbnail=True, source="flip")
    monkeypatch.setattr(covers, "_search_flip", lambda q: [book])
    row = BookCover(key=covers.cover_key("Гауһар тас"), query="Гауһар тас", status="working", attempts=0)
    covers._look_up(row, None, only_flip=True)
    assert row.status == "found" and row.source == "flip"
    assert asked == []
