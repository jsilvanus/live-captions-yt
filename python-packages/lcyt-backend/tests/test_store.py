"""Tests for the SessionStore."""

import pytest
from lcyt_backend.store import SessionStore, make_session_id


class MockSender:
    def __init__(self):
        self.ended = False

    def end(self):
        self.ended = True


def _make_session(store, api_key="k1", stream_key="s1", domain="https://example.com", **kwargs):
    sender = MockSender()
    return store.create(
        api_key=api_key,
        stream_key=stream_key,
        domain=domain,
        jwt="tok",
        sender=sender,
        **kwargs,
    )


def test_make_session_id_deterministic():
    a = make_session_id("k", "s", "d")
    b = make_session_id("k", "s", "d")
    assert a == b
    assert len(a) == 16


def test_make_session_id_unique():
    assert make_session_id("k1", "s", "d") != make_session_id("k2", "s", "d")


def test_create_and_get(store):
    s = _make_session(store)
    assert store.has(s["session_id"])
    assert store.get(s["session_id"]) is s


def test_has_returns_false_for_missing(store):
    assert not store.has("nonexistent")


def test_get_returns_none_for_missing(store):
    assert store.get("nonexistent") is None


def test_size(store):
    assert store.size() == 0
    _make_session(store, api_key="k1")
    _make_session(store, api_key="k2")
    assert store.size() == 2


def test_remove(store):
    s = _make_session(store)
    removed = store.remove(s["session_id"])
    assert removed is s
    assert not store.has(s["session_id"])


def test_remove_nonexistent_returns_none(store):
    assert store.remove("ghost") is None


def test_get_by_domain(store):
    _make_session(store, api_key="k1", domain="https://a.example.com")
    _make_session(store, api_key="k2", domain="https://b.example.com")
    results = store.get_by_domain("https://a.example.com")
    assert len(results) == 1
    assert results[0]["domain"] == "https://a.example.com"


def test_touch_updates_activity(store):
    import time
    s = _make_session(store)
    before = s["last_activity_at"]
    time.sleep(0.01)
    store.touch(s["session_id"])
    assert s["last_activity_at"] > before


def test_all_returns_snapshot(store):
    _make_session(store, api_key="k1")
    _make_session(store, api_key="k2")
    sessions = store.all()
    assert len(sessions) == 2


def test_idempotent_create_uses_same_session_id(store):
    """Two creates with same keys produce the same session_id (overwrite)."""
    s1 = _make_session(store)
    s2 = _make_session(store)  # same default keys
    assert s1["session_id"] == s2["session_id"]
    assert store.size() == 1  # second create overwrote the first


def test_cleanup_removes_expired(tmp_path):
    # Use very short TTL and no auto-cleanup (manual sweep)
    store = SessionStore(session_ttl=0, cleanup_interval=0)
    s = _make_session(store)
    import time
    time.sleep(0.01)
    store._sweep()
    assert not store.has(s["session_id"])
    assert s["sender"].ended is True
