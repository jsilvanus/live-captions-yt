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


def test_health_no_auth_required(client):
    res = client.get("/health")
    assert res.status_code == 200


def test_health_reflects_session_count(client, store):
    class _MockSender:
        def end(self):
            pass

    store.create(
        api_key="h-key",
        stream_key="h-stream",
        domain="https://h.example.com",
        jwt="tok",
        sender=_MockSender(),
    )

    data = client.get("/health").get_json()
    assert data["activeSessions"] == 1
