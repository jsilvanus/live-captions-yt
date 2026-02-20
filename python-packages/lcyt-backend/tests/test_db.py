"""Tests for db.py database operations."""

import pytest
from lcyt_backend.db import (
    create_key,
    delete_key,
    get_all_keys,
    get_key,
    init_db,
    revoke_key,
    update_key,
    validate_api_key,
)


@pytest.fixture
def conn(tmp_path):
    c = init_db(str(tmp_path / "test.db"))
    yield c
    c.close()


def test_init_db_creates_table(conn):
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='api_keys'"
    ).fetchone()
    assert row is not None


def test_create_and_get_key(conn):
    key = create_key(conn, owner="alice")
    assert key is not None
    assert key["owner"] == "alice"
    assert key["active"] == 1
    assert key["expires_at"] is None

    fetched = get_key(conn, key["key"])
    assert fetched["key"] == key["key"]


def test_create_key_with_explicit_key(conn):
    key = create_key(conn, owner="bob", key="explicit-key-123")
    assert key["key"] == "explicit-key-123"


def test_create_key_with_expiry(conn):
    key = create_key(conn, owner="carol", expires_at="2099-01-01T00:00:00")
    assert key["expires_at"] == "2099-01-01T00:00:00"


def test_validate_api_key_valid(conn):
    key = create_key(conn, owner="dave")
    result = validate_api_key(conn, key["key"])
    assert result["valid"] is True
    assert result["owner"] == "dave"


def test_validate_api_key_unknown(conn):
    result = validate_api_key(conn, "nonexistent-key")
    assert result["valid"] is False
    assert result["reason"] == "unknown_key"


def test_validate_api_key_revoked(conn):
    key = create_key(conn, owner="eve")
    revoke_key(conn, key["key"])
    result = validate_api_key(conn, key["key"])
    assert result["valid"] is False
    assert result["reason"] == "revoked"


def test_validate_api_key_expired(conn):
    key = create_key(conn, owner="frank", expires_at="2000-01-01T00:00:00")
    result = validate_api_key(conn, key["key"])
    assert result["valid"] is False
    assert result["reason"] == "expired"


def test_revoke_key(conn):
    key = create_key(conn, owner="grace")
    changed = revoke_key(conn, key["key"])
    assert changed is True
    assert get_key(conn, key["key"])["active"] == 0


def test_revoke_key_nonexistent(conn):
    assert revoke_key(conn, "ghost") is False


def test_delete_key(conn):
    key = create_key(conn, owner="hank")
    assert delete_key(conn, key["key"]) is True
    assert get_key(conn, key["key"]) is None


def test_delete_key_nonexistent(conn):
    assert delete_key(conn, "ghost") is False


def test_get_all_keys(conn):
    create_key(conn, owner="ivan")
    create_key(conn, owner="judy")
    keys = get_all_keys(conn)
    assert len(keys) == 2


def test_update_key_owner(conn):
    key = create_key(conn, owner="karl")
    update_key(conn, key["key"], owner="karl-updated")
    assert get_key(conn, key["key"])["owner"] == "karl-updated"


def test_update_key_expires_at(conn):
    key = create_key(conn, owner="lisa")
    update_key(conn, key["key"], expires_at="2099-06-01T00:00:00")
    assert get_key(conn, key["key"])["expires_at"] == "2099-06-01T00:00:00"


def test_update_key_clear_expires(conn):
    key = create_key(conn, owner="mike", expires_at="2099-01-01T00:00:00")
    update_key(conn, key["key"], expires_at=None)
    assert get_key(conn, key["key"])["expires_at"] is None


def test_update_key_no_fields(conn):
    key = create_key(conn, owner="nina")
    result = update_key(conn, key["key"])
    assert result is False
