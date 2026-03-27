"""Tests for POST /sync."""


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_sync_returns_200(client, session_token):
    res = client.post("/sync/", headers=_auth(session_token))
    assert res.status_code == 200


def test_sync_response_fields(client, session_token):
    res = client.post("/sync/", headers=_auth(session_token))
    data = res.get_json()
    assert isinstance(data["syncOffset"], int)
    assert isinstance(data["roundTripTime"], int)
    assert data["roundTripTime"] >= 0
    assert "serverTimestamp" in data
    assert "statusCode" in data


def test_sync_no_auth(client):
    res = client.post("/sync/")
    assert res.status_code == 401
