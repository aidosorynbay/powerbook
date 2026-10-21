"""The last try for a cover: Claude finds the book's page, Claude checks the picture."""
import pytest

from app.core.config import settings
from app.models.book_cover import BookCover
from app.services import claude, covers, covers_ai

PAGE = (
    '<html><head><meta property="og:title" content="Гауһар тас"/>'
    '<meta property="og:image" content="/media/gauhar.jpg?w=600&amp;h=900"/>'
    '<meta name="twitter:image" content="https://cdn.shop.kz/gauhar.jpg"></head></html>'
)


def test_the_pictures_a_page_names_as_its_own():
    assert covers_ai.page_pictures("https://shop.kz/book/1", PAGE) == [
        "https://shop.kz/media/gauhar.jpg?w=600&h=900",
        "https://cdn.shop.kz/gauhar.jpg",
    ]


@pytest.mark.parametrize("url", ["http://shop.kz/a.jpg", "https://localhost/a.jpg", "https://127.0.0.1/a.jpg",
                                 "https://10.0.0.5/a.jpg", "file:///etc/passwd"])
def test_never_this_servers_own_network(url):
    assert not covers_ai._public(url)


@pytest.fixture()
def web(monkeypatch, tmp_path):
    """Claude finds one shop page; the page names one picture; Claude's verdict on it is `verdict`."""
    state = {"verdict": {"front_cover": True, "same_book": True, "title_on_cover": "Гауһар тас"}, "asked": []}

    def ask_json(*, system, prompt, schema, web_search=False, effort="medium", max_tokens=16000):
        state["asked"].append("search" if web_search else "look")
        if web_search:
            return {"found": True, "title": "Гауһар тас", "author": "Дулат Исабеков",
                    "pages": ["https://shop.kz/book/1"], "images": []}
        assert prompt[0]["type"] == "image"
        return state["verdict"]

    monkeypatch.setattr(settings, "ai_covers", True)
    monkeypatch.setattr(settings, "ai_covers_daily_limit", 2)
    monkeypatch.setattr(covers_ai, "_spent", {})
    monkeypatch.setattr(claude, "available", lambda: True)
    monkeypatch.setattr(claude, "ask_json", ask_json)
    monkeypatch.setattr(covers_ai, "_public", lambda url: True)
    monkeypatch.setattr(covers_ai, "_allowed", lambda url: True)
    monkeypatch.setattr(covers, "_get", lambda url, timeout=15: (PAGE.encode(), "text/html; charset=utf-8"))
    monkeypatch.setattr(covers, "_cover_bytes", lambda url, min_width, portrait=True: b"jpeg:" + url.encode())
    # Every catalogue and shop comes back empty.
    monkeypatch.setattr(covers, "COVERS_DIR", tmp_path)
    monkeypatch.setattr(covers, "_search", lambda q: [])
    monkeypatch.setattr(covers, "_search_flip", lambda q: [])
    monkeypatch.setattr(covers, "_wikidata_cover", lambda q: None)
    return state


def _look_up(query):
    row = BookCover(key=covers.cover_key(query), query=query, status="working", attempts=0)
    covers._look_up(row, None)
    return row


def test_found_on_the_web_and_looked_at_before_it_goes_on_the_shelf(web):
    row = _look_up("Гауһар тас")
    assert row.status == "found" and row.source == "claude" and row.image
    assert row.author == "Дулат Исабеков"
    assert web["asked"] == ["search", "look"]


def test_a_picture_claude_does_not_recognise_stays_off_the_shelf(web):
    web["verdict"] = {"front_cover": True, "same_book": False, "title_on_cover": "Алтын адам"}
    row = _look_up("Гауһар тас")
    assert row.status == "none" and row.image is None
    # Both pictures the page named were looked at.
    assert web["asked"] == ["search", "look", "look"]


def test_a_few_a_day(web):
    _look_up("Гауһар тас")
    _look_up("Қан мен тер")
    web["asked"].clear()
    assert _look_up("Көшпенділер").status == "none"
    assert web["asked"] == []


def test_without_a_key_nothing_is_asked(web, monkeypatch):
    monkeypatch.setattr(claude, "available", lambda: False)
    assert _look_up("Гауһар тас").status == "none"
    assert web["asked"] == []
