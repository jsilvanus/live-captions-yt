"""Tests for POST /captions."""

import pytest
from lcyt_backend.db import create_key
from lcyt_backend.store import make_session_id


@pytest.fixture
def session_token(client, db, store, mock_sender, monkeypatch):
    """Register a session and return its JWT token."""
    import lcyt_backend.routes.live as live_module
    monkeypatch.setattr(live_module, "import_sender", lambda: mock_sender)

    key_row = create_key(db, owner="caption-test")
    res = client.post(
        "/live/",
        json={
            "apiKey": key_row["key"],
            "streamKey": "stream-cap",
            "domain": "https://example.com",
        },
    )
    assert res.status_code == 200
    return res.get_json()["token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_send_single_caption(client, session_token):
    res = client.post(
        "/captions/",
        json={"captions": [{"text": "Hello world"}]},
        headers=_auth(session_token),
    )
    assert res.status_code == 200
    data = res.get_json()
    assert "sequence" in data
    assert "statusCode" in data


def test_send_batch_captions(client, session_token):
    res = client.post(
        "/captions/",
        json={"captions": [{"text": "Line 1"}, {"text": "Line 2"}]},
        headers=_auth(session_token),
    )
    assert res.status_code == 200
    data = res.get_json()
    assert data["count"] == 2


def test_send_captions_no_auth(client):
    res = client.post("/captions/", json={"captions": [{"text": "Hi"}]})
    assert res.status_code == 401


def test_send_captions_empty_array(client, session_token):
    res = client.post(
        "/captions/",
        json={"captions": []},
        headers=_auth(session_token),
    )
    assert res.status_code == 400


def test_send_captions_missing_field(client, session_token):
    res = client.post(
        "/captions/",
        json={},
        headers=_auth(session_token),
    )
    assert res.status_code == 400


def test_send_captions_with_relative_time(client, session_token):
    """Captions with 'time' (ms since start) should be accepted."""
    res = client.post(
        "/captions/",
        json={"captions": [{"text": "Timed caption", "time": 1000}]},
        headers=_auth(session_token),
    )
    assert res.status_code == 200


def test_send_captions_with_absolute_timestamp(client, session_token):
    res = client.post(
        "/captions/",
        json={"captions": [{"text": "Stamped", "timestamp": "2024-01-01T12:00:00.000"}]},
        headers=_auth(session_token),
    )
    assert res.status_code == 200
