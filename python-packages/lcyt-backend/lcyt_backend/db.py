"""SQLite database operations for lcyt-backend."""

import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

DEFAULT_DB_PATH = Path(__file__).parent.parent / "lcyt-backend.db"


def init_db(db_path: Optional[str] = None) -> sqlite3.Connection:
    """Open/create the SQLite database and ensure the api_keys table exists.

    Args:
        db_path: Path to the SQLite database file. Defaults to DB_PATH env var
                 or lcyt-backend.db next to the package.

    Returns:
        Open sqlite3 connection with row_factory set to sqlite3.Row.
    """
    resolved_path = db_path or os.environ.get("DB_PATH", str(DEFAULT_DB_PATH))
    conn = sqlite3.connect(resolved_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS api_keys (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            key        TEXT    NOT NULL UNIQUE,
            owner      TEXT    NOT NULL,
            created_at TEXT    NOT NULL DEFAULT (datetime('now')),
            expires_at TEXT,
            active     INTEGER NOT NULL DEFAULT 1
        )
    """)
    conn.commit()
    return conn


def _row_to_dict(row: sqlite3.Row) -> dict:
    return dict(row)


def validate_api_key(conn: sqlite3.Connection, key: str) -> dict:
    """Validate an API key against the database.

    Returns:
        {'valid': True, 'owner': str, 'expires_at': str|None}
        or {'valid': False, 'reason': str}
    """
    row = conn.execute(
        "SELECT * FROM api_keys WHERE key = ?", (key,)
    ).fetchone()

    if row is None:
        return {"valid": False, "reason": "unknown_key"}

    if row["active"] == 0:
        return {"valid": False, "reason": "revoked"}

    if row["expires_at"]:
        expires = datetime.fromisoformat(row["expires_at"]).replace(tzinfo=timezone.utc)
        if expires < datetime.now(timezone.utc):
            return {"valid": False, "reason": "expired"}

    return {"valid": True, "owner": row["owner"], "expires_at": row["expires_at"]}


def get_all_keys(conn: sqlite3.Connection) -> list[dict]:
    """Get all API keys ordered by id."""
    rows = conn.execute("SELECT * FROM api_keys ORDER BY id").fetchall()
    return [_row_to_dict(r) for r in rows]


def get_key(conn: sqlite3.Connection, key: str) -> Optional[dict]:
    """Get a single API key row, or None if not found."""
    row = conn.execute(
        "SELECT * FROM api_keys WHERE key = ?", (key,)
    ).fetchone()
    return _row_to_dict(row) if row else None


def create_key(
    conn: sqlite3.Connection,
    owner: str,
    key: Optional[str] = None,
    expires_at: Optional[str] = None,
) -> dict:
    """Create a new API key.

    Args:
        conn: Database connection.
        owner: Key owner label.
        key: Optional explicit key value. Defaults to a new UUID.
        expires_at: Optional ISO date string for expiration.

    Returns:
        The created row as a dict.
    """
    resolved_key = key or str(uuid.uuid4())
    conn.execute(
        "INSERT INTO api_keys (key, owner, expires_at) VALUES (?, ?, ?)",
        (resolved_key, owner, expires_at),
    )
    conn.commit()
    return get_key(conn, resolved_key)


def revoke_key(conn: sqlite3.Connection, key: str) -> bool:
    """Soft-delete (revoke) an API key.

    Returns:
        True if a row was updated.
    """
    cursor = conn.execute(
        "UPDATE api_keys SET active = 0 WHERE key = ?", (key,)
    )
    conn.commit()
    return cursor.rowcount > 0


def delete_key(conn: sqlite3.Connection, key: str) -> bool:
    """Permanently delete an API key.

    Returns:
        True if a row was deleted.
    """
    cursor = conn.execute("DELETE FROM api_keys WHERE key = ?", (key,))
    conn.commit()
    return cursor.rowcount > 0


_UNSET = object()


def update_key(
    conn: sqlite3.Connection,
    key: str,
    owner: Optional[str] = None,
    expires_at=_UNSET,
) -> bool:
    """Update owner and/or expires_at for a key.

    Pass ``expires_at=None`` explicitly to clear the expiration.
    Omit ``expires_at`` (leave as sentinel) to leave it unchanged.

    Returns:
        True if a row was updated.
    """
    parts = []
    params = []

    if owner is not None:
        parts.append("owner = ?")
        params.append(owner)

    if expires_at is not _UNSET:
        parts.append("expires_at = ?")
        params.append(expires_at)

    if not parts:
        return False

    params.append(key)
    cursor = conn.execute(
        f"UPDATE api_keys SET {', '.join(parts)} WHERE key = ?",
        params,
    )
    conn.commit()
    return cursor.rowcount > 0
