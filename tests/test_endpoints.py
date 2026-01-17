def test_root(client):
    resp = client.get("/")
    assert resp.status_code == 200
    assert "message" in resp.json()


def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_items(client):
    resp = client.get("/api/items/123")
    assert resp.status_code == 200
    assert resp.json() == {"item_id": 123}

