"""Tests for POST/GET/DELETE /live (relay-mode, no API key validation)."""


def test_register_session_success(client, mock_sender, monkeypatch):
    monkeypatch.setattr(
        "lcyt_backend.routes.live.import_sender", lambda: mock_sender
    )
    resp = client.post("/live/", json={
        "apiKey": "any-key",
        "streamKey": "test-stream-key",
        "domain": "localhost",
    })
    assert resp.status_code == 200
    data = resp.get_json()
    assert "token" in data
    assert "sessionId" in data
    assert "syncOffset" in data


def test_register_session_missing_stream_key(client):
    resp = client.post("/live/", json={
        "apiKey": "key",
        "domain": "localhost",
    })
    assert resp.status_code == 400


def test_register_session_stream_key_from_targets(client, mock_sender, monkeypatch):
    monkeypatch.setattr(
        "lcyt_backend.routes.live.import_sender", lambda: mock_sender
    )
    resp = client.post("/live/", json={
        "apiKey": "any-key",
        "domain": "localhost",
        "targets": [{"type": "youtube", "streamKey": "from-target"}],
    })
    assert resp.status_code == 200


def test_register_session_idempotent(client, mock_sender, monkeypatch):
    monkeypatch.setattr(
        "lcyt_backend.routes.live.import_sender", lambda: mock_sender
    )
    body = {"apiKey": "key", "streamKey": "sk", "domain": "localhost"}
    r1 = client.post("/live/", json=body)
    r2 = client.post("/live/", json=body)
    assert r1.get_json()["sessionId"] == r2.get_json()["sessionId"]
    assert r1.get_json()["token"] == r2.get_json()["token"]


def test_register_no_api_key_validation(client, mock_sender, monkeypatch):
    """Any apiKey is accepted — no database validation."""
    monkeypatch.setattr(
        "lcyt_backend.routes.live.import_sender", lambda: mock_sender
    )
    resp = client.post("/live/", json={
        "apiKey": "completely-made-up-key",
        "streamKey": "sk",
        "domain": "localhost",
    })
    assert resp.status_code == 200


def test_get_session_status(client, session_token):
    resp = client.get("/live/", headers={"Authorization": f"Bearer {session_token}"})
    assert resp.status_code == 200
    data = resp.get_json()
    assert "sequence" in data
    assert "syncOffset" in data


def test_get_session_no_auth(client):
    resp = client.get("/live/")
    assert resp.status_code == 401


def test_delete_session(client, session_token):
    resp = client.delete("/live/", headers={"Authorization": f"Bearer {session_token}"})
    assert resp.status_code == 200
    assert resp.get_json()["removed"] is True


def test_delete_then_get_returns_404(client, session_token):
    client.delete("/live/", headers={"Authorization": f"Bearer {session_token}"})
    resp = client.get("/live/", headers={"Authorization": f"Bearer {session_token}"})
    assert resp.status_code == 404
