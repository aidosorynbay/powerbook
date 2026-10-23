"""Covers from Читай-город for Russian editions, and the matcher's volume numbers and «!» subtitles."""
import pytest

from app.services import covers

_CARD = (
    '<article class="product-card product-card__view-type--base app-products-list__item" style="" '
    'data-testid-product-item="{id}"><div class="product-card__image-wrapper">'
    '<a href="/product/{slug}-{id}" class="" title="{label}"><img width="300" height="300" data-nuxt-img '
    'srcset="https://content.img-gorod.ru/pim/products/images/{img}.jpg?width=300&amp;height=300 1x"></a></div></article>'
)
SEARCH = "".join(
    [
        _CARD.format(id=3034785, slug="atomnye-privychki", img="43/2d/aaa",
                     label="Атомные привычки. Как приобрести хорошие привычки и избавиться от плохих (Джеймс Клир)"),
        _CARD.format(id=2999, slug="shantaram", img="11/22/bbb",
                     label="Шантарам (в 2-х томах) (комплект) (Грегори Дэвид Робертс)"),
        _CARD.format(id=3001, slug="hvatit", img="33/44/ccc",
                     label="Хватит мечтать, займись делом! Почему важно (Кэл Ньюпорт, Иван Иванов)"),
    ]
)


@pytest.fixture()
def chitai(monkeypatch):
    asked: list[str] = []

    def get(url):
        asked.append(url)
        if "/search?" in url:
            return '<html><head><meta http-equiv="refresh" content="0; url=/search/atomnye-privychki"></head></html>'
        return SEARCH

    monkeypatch.setattr(covers.settings, "chitai_covers", True)
    monkeypatch.setattr(covers, "_chitai_get", get)
    return asked


def test_each_card_is_a_book_with_its_author_and_cover(chitai):
    found = covers._search_chitai("Атомные привычки")
    assert [c.volume_id for c in found] == ["3034785", "2999", "3001"]
    first = found[0]
    assert first.source == "chitai" and first.creators == ["Джеймс Клир"]
    assert first.titles == ["Атомные привычки. Как приобрести хорошие привычки и избавиться от плохих"]
    assert first.image_url == "https://content.img-gorod.ru/pim/products/images/43/2d/aaa.jpg"
    assert found[2].creators == ["Кэл Ньюпорт", "Иван Иванов"]
    # The search's refresh is followed to its own address.
    assert chitai[-1] == "https://www.chitai-gorod.ru/search/atomnye-privychki"


def test_the_matcher_takes_the_shops_names(chitai):
    found = {c.volume_id: c for c in covers._search_chitai("x")}
    assert covers._judge("Атомные привычки", None, found["3034785"])
    assert covers._judge("Хватит мечтать, займись делом", None, found["3001"])
    core = covers._VOLUME.sub("", "Шантарам 1").strip(covers._TRIM)
    assert covers._judge(core, None, found["2999"])


def test_kazakh_titles_and_the_switch_ask_nobody(chitai, monkeypatch):
    assert covers._search_chitai("Гауһар тас") == []
    monkeypatch.setattr(covers.settings, "chitai_covers", False)
    assert covers._search_chitai("Атомные привычки") == []
    assert chitai == []


def test_a_quiet_visitor_the_day_has_a_ceiling(monkeypatch):
    monkeypatch.setattr(covers, "_CHITAI_GAP_SECONDS", 0)
    monkeypatch.setattr(covers, "_CHITAI_DAILY_CAP", 2)
    monkeypatch.setattr(covers, "_chitai_spent", {})
    monkeypatch.setattr(covers, "_get", lambda url, timeout=15: (b"<html></html>", "text/html"))
    covers._chitai_get("https://www.chitai-gorod.ru/a")
    covers._chitai_get("https://www.chitai-gorod.ru/b")
    with pytest.raises(RuntimeError):
        covers._chitai_get("https://www.chitai-gorod.ru/c")


def test_its_pictures_come_from_its_own_service_only(monkeypatch):
    asked = []
    monkeypatch.setattr(covers, "_cover_bytes", lambda url, min_width, portrait=True: asked.append(url) or b"jpeg")
    good = covers._Candidate(volume_id="1", titles=["x"], creators=[], has_thumbnail=True, source="chitai",
                             image_url="https://content.img-gorod.ru/pim/a.jpg")
    assert covers._fetch_images(good) == (b"jpeg", b"jpeg")
    assert asked == ["https://content.img-gorod.ru/pim/a.jpg?width=600&height=900",
                     "https://content.img-gorod.ru/pim/a.jpg?width=400&height=600"]
    bad = covers._Candidate(volume_id="2", titles=["x"], creators=[], has_thumbnail=True, source="chitai",
                            image_url="https://elsewhere.example/a.jpg")
    assert covers._fetch_images(bad) is None


@pytest.mark.parametrize(
    ("typed", "core"),
    [("Шантарам 1", "Шантарам"), ("Сынық құмыра 5", "Сынық құмыра"), ("Метро 2033", "Метро 2033"),
     ("1984", "1984"), ("Три товарища", "Три товарища")],
)
def test_a_bare_volume_number_is_not_part_of_the_name(typed, core):
    assert (covers._VOLUME.sub("", typed).strip(covers._TRIM) or typed) == core


def test_a_subtitle_after_an_exclamation_is_cut():
    assert covers._head("Начни с главного! 1 удивительно простой принцип") == "Начни с главного"
    assert covers._head("Хватит мечтать, займись делом! Почему важно") == "Хватит мечтать, займись делом"


def test_a_russian_title_asks_the_shop_before_google(monkeypatch, tmp_path):
    order = []
    book = covers._Candidate(volume_id="1", titles=["Важные годы"], creators=["Мэг Джей"], has_thumbnail=True,
                             source="chitai", image_url="https://content.img-gorod.ru/a.jpg")
    monkeypatch.setattr(covers, "COVERS_DIR", tmp_path)
    monkeypatch.setattr(covers, "_search_chitai", lambda q: order.append("chitai") or [book])
    monkeypatch.setattr(covers, "_search", lambda q: order.append("google") or [])
    monkeypatch.setattr(covers, "_fetch_images", lambda c, min_width=250: (b"full", b"small"))
    from app.models.book_cover import BookCover

    row = BookCover(key=covers.cover_key("Важные годы"), query="Важные годы", status="working", attempts=0)
    covers._look_up(row, None)
    assert row.source == "chitai" and row.image
    assert order == ["chitai"]
