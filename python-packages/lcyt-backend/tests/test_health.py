"""Tests for GET /health."""


def test_health_returns_200(client):
    res = client.get("/health")
    assert res.status_code == 200


def test_health_body(client):
    data = client.get("/health").get_json()
    assert data["ok"] is True
    assert isinstance(data["uptime"], (int, float))
    assert data["uptime"] >= 0
    assert isinstance(data["activeSessions"], int)
    assert data["activeSessions"] == 0


def test_health_features_list(client):
    data = client.get("/health").get_json()
    assert isinstance(data["features"], list)
    assert "captions" in data["features"]
    assert "sync" in data["features"]


def test_health_no_auth_required(client):
    res = client.get("/health")
    assert res.status_code == 200
