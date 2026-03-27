"""Tests for POST /captions."""

import pytest


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


def test_send_captions_with_absolute_timestamp(client, session_token):
    res = client.post(
        "/captions/",
        json={"captions": [{"text": "Stamped", "timestamp": "2024-01-01T12:00:00.000"}]},
        headers=_auth(session_token),
    )
    assert res.status_code == 200
