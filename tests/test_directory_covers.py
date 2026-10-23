"""«Читатели»: each reader's recent books come with their covers, found in one pass for everyone."""
import uuid
from types import SimpleNamespace

from app.services import leagues
from app.services.social import SocialService


def test_each_recent_book_gets_its_own_cover(monkeypatch):
    dana, aidos, empty = (SimpleNamespace(id=uuid.uuid4(), username=n, display_name=n, telegram_handle=None,
                                          avatar_data=None, recommendation_text=None) for n in ("dana", "aidos", "empty"))
    shelves = {
        dana.id: ["Три товарища", "Шантарам", "Абай жолы", "Older"],
        aidos.id: ["Атомные привычки"],
        empty.id: [],
    }
    asked = []

    service = SocialService.__new__(SocialService)
    service.db = None
    service.pending_lookups = {}
    service.users = SimpleNamespace(list_real_users=lambda: [dana, aidos, empty])
    service.insights = SimpleNamespace(
        bookshelf=lambda user_id, public: [SimpleNamespace(title=t) for t in shelves[user_id]],
        badges=lambda user_id: [],
    )
    service._archetype_ref = lambda user_id: (None, None)
    service._archive_directory = lambda: []

    def favorite_covers(titles):
        asked.append(list(titles))
        return [None if t == "Абай жолы" else f"/library/covers/{t}.jpg" for t in titles]

    service.favorite_covers = favorite_covers
    monkeypatch.setattr(leagues, "leagues_by_user", lambda db: {})

    out = {e.username: e for e in service.directory()}
    # One pass for everyone, three latest each.
    assert asked == [["Три товарища", "Шантарам", "Абай жолы", "Атомные привычки"]]
    assert out["dana"].recent_covers == ["/library/covers/Три товарища.jpg", "/library/covers/Шантарам.jpg", None]
    assert out["aidos"].recent_covers == ["/library/covers/Атомные привычки.jpg"]
    assert out["empty"].recent_covers == []
