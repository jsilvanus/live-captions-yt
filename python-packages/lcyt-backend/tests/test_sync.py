"""Tests for POST /sync."""

import pytest
from lcyt_backend.db import create_key


@pytest.fixture
def session_token(client, db, monkeypatch, mock_sender):
    """Register a session and return its JWT."""
    import lcyt_backend.routes.live as live_module
    monkeypatch.setattr(live_module, "import_sender", lambda: mock_sender)

    key_row = create_key(db, owner="sync-test")
    res = client.post(
        "/live/",
        json={
            "apiKey": key_row["key"],
            "streamKey": "stream-sync",
            "domain": "https://example.com",
        },
    )
    assert res.status_code == 200
    return res.get_json()["token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_sync_returns_200(client, session_token):
    res = client.post("/sync/", headers=_auth(session_token))
    assert res.status_code == 200


def test_sync_response_fields(client, session_token):
    data = client.post("/sync/", headers=_auth(session_token)).get_json()
    assert "syncOffset" in data
    assert "roundTripTime" in data
    assert "statusCode" in data
    assert isinstance(data["syncOffset"], int)
    assert isinstance(data["roundTripTime"], int)
    assert data["roundTripTime"] >= 0


def test_sync_no_auth(client):
    res = client.post("/sync/")
    assert res.status_code == 401


def test_sync_updates_session_offset(client, session_token, store):
    import os
    from lcyt_backend._jwt import decode as jwt_decode
    payload = jwt_decode(session_token, os.environ["JWT_SECRET"])
    session_id = payload["sessionId"]

    client.post("/sync/", headers=_auth(session_token))
    session = store.get(session_id)
    assert isinstance(session["sync_offset"], int)
