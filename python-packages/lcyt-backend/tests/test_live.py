"""Tests for POST/GET/DELETE /live."""

import json
import pytest

from lcyt_backend.db import create_key


@pytest.fixture
def api_key(db):
    """Create a valid API key in the test database."""
    row = create_key(db, owner="test-owner")
    return row["key"]


@pytest.fixture(autouse=True)
def patch_sender(monkeypatch, mock_sender):
    """Replace YoutubeLiveCaptionSender with a mock in the live route."""
    import lcyt_backend.routes.live as live_module
    monkeypatch.setattr(live_module, "import_sender", lambda: mock_sender)


def _register(client, api_key, stream_key="stream123", domain="https://example.com"):
    return client.post(
        "/live/",
        json={"apiKey": api_key, "streamKey": stream_key, "domain": domain},
    )


def test_register_session_success(client, api_key):
    res = _register(client, api_key)
    assert res.status_code == 200
    data = res.get_json()
    assert "token" in data
    assert "sessionId" in data
    assert isinstance(data["sequence"], int)
    assert isinstance(data["syncOffset"], int)
    assert isinstance(data["startedAt"], float)


def test_register_session_missing_fields(client):
    res = client.post("/live/", json={"apiKey": "x"})
    assert res.status_code == 400
    assert "error" in res.get_json()


def test_register_session_invalid_api_key(client):
    res = _register(client, "bad-key")
    assert res.status_code == 401


def test_register_session_idempotent(client, api_key):
    res1 = _register(client, api_key)
    res2 = _register(client, api_key)
    assert res1.status_code == 200
    assert res2.status_code == 200
    assert res1.get_json()["token"] == res2.get_json()["token"]
    assert res1.get_json()["sessionId"] == res2.get_json()["sessionId"]


def test_get_session_status(client, api_key, jwt_secret):
    token = _register(client, api_key).get_json()["token"]
    res = client.get("/live/", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.get_json()
    assert "sequence" in data
    assert "syncOffset" in data


def test_get_session_status_no_auth(client):
    res = client.get("/live/")
    assert res.status_code == 401


def test_get_session_status_bad_token(client):
    res = client.get("/live/", headers={"Authorization": "Bearer bad-token"})
    assert res.status_code == 401


def test_delete_session(client, api_key):
    token = _register(client, api_key).get_json()["token"]
    res = client.delete("/live/", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.get_json()
    assert data["removed"] is True


def test_delete_session_then_get_returns_404(client, api_key):
    token = _register(client, api_key).get_json()["token"]
    client.delete("/live/", headers={"Authorization": f"Bearer {token}"})
    res = client.get("/live/", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 404
