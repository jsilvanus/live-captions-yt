"""Tests for CRUD /keys (admin API)."""

import pytest
from lcyt_backend.db import create_key


def _admin(headers=None):
    h = {"X-Admin-Key": "test-admin-key"}
    if headers:
        h.update(headers)
    return h


def test_list_keys_empty(client):
    res = client.get("/keys/", headers=_admin())
    assert res.status_code == 200
    assert res.get_json()["keys"] == []


def test_create_key(client):
    res = client.post("/keys/", json={"owner": "alice"}, headers=_admin())
    assert res.status_code == 201
    data = res.get_json()
    assert data["owner"] == "alice"
    assert data["active"] is True
    assert "key" in data
    assert "createdAt" in data


def test_create_key_with_explicit_key(client):
    res = client.post("/keys/", json={"owner": "bob", "key": "my-key-abc"}, headers=_admin())
    assert res.status_code == 201
    assert res.get_json()["key"] == "my-key-abc"


def test_create_key_missing_owner(client):
    res = client.post("/keys/", json={}, headers=_admin())
    assert res.status_code == 400


def test_get_key(client):
    key = client.post("/keys/", json={"owner": "carol"}, headers=_admin()).get_json()["key"]
    res = client.get(f"/keys/{key}", headers=_admin())
    assert res.status_code == 200
    assert res.get_json()["owner"] == "carol"


def test_get_key_not_found(client):
    res = client.get("/keys/nonexistent", headers=_admin())
    assert res.status_code == 404


def test_list_keys_shows_created(client):
    client.post("/keys/", json={"owner": "dave"}, headers=_admin())
    client.post("/keys/", json={"owner": "eve"}, headers=_admin())
    data = client.get("/keys/", headers=_admin()).get_json()
    assert len(data["keys"]) == 2


def test_patch_key_owner(client):
    key = client.post("/keys/", json={"owner": "frank"}, headers=_admin()).get_json()["key"]
    res = client.patch(f"/keys/{key}", json={"owner": "frank-updated"}, headers=_admin())
    assert res.status_code == 200
    assert res.get_json()["owner"] == "frank-updated"


def test_patch_key_expires(client):
    key = client.post("/keys/", json={"owner": "grace"}, headers=_admin()).get_json()["key"]
    res = client.patch(f"/keys/{key}", json={"expires": "2099-01-01T00:00:00"}, headers=_admin())
    assert res.status_code == 200
    assert res.get_json()["expires"] == "2099-01-01T00:00:00"


def test_patch_key_not_found(client):
    res = client.patch("/keys/ghost", json={"owner": "x"}, headers=_admin())
    assert res.status_code == 404


def test_delete_key_revoke(client):
    key = client.post("/keys/", json={"owner": "hank"}, headers=_admin()).get_json()["key"]
    res = client.delete(f"/keys/{key}", headers=_admin())
    assert res.status_code == 200
    assert res.get_json()["revoked"] is True
    # Key still exists but is inactive
    row = client.get(f"/keys/{key}", headers=_admin()).get_json()
    assert row["active"] is False


def test_delete_key_permanent(client):
    key = client.post("/keys/", json={"owner": "ivan"}, headers=_admin()).get_json()["key"]
    res = client.delete(f"/keys/{key}?permanent=true", headers=_admin())
    assert res.status_code == 200
    assert res.get_json()["deleted"] is True
    assert client.get(f"/keys/{key}", headers=_admin()).status_code == 404


def test_delete_key_not_found(client):
    res = client.delete("/keys/nonexistent", headers=_admin())
    assert res.status_code == 404


def test_requires_admin_key(client):
    res = client.get("/keys/")
    assert res.status_code == 401


def test_wrong_admin_key(client):
    res = client.get("/keys/", headers={"X-Admin-Key": "wrong"})
    assert res.status_code == 403


def test_admin_not_configured(client, monkeypatch):
    import os
    monkeypatch.delenv("ADMIN_KEY", raising=False)
    res = client.get("/keys/")
    assert res.status_code == 503
