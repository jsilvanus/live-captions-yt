"""In-memory session store for lcyt-backend."""

import hashlib
import os
import threading
import time
from datetime import datetime, timezone
from typing import Iterable, Iterator, Optional

DEFAULT_SESSION_TTL = int(os.environ.get("SESSION_TTL", str(2 * 60 * 60)))  # 2 hours (seconds)
DEFAULT_CLEANUP_INTERVAL = int(os.environ.get("CLEANUP_INTERVAL", str(5 * 60)))  # 5 minutes


def make_session_id(api_key: str, stream_key: str, domain: str) -> str:
    """Generate a deterministic session ID from the composite key.

    SHA-256 hash of "apiKey:streamKey:domain", truncated to 16 hex chars.
    This avoids embedding the raw API key in JWT payloads.

    Args:
        api_key: The client's API key.
        stream_key: The YouTube stream key.
        domain: The registered origin domain.

    Returns:
        16-character hex string.
    """
    raw = f"{api_key}:{stream_key}:{domain}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


class SessionStore:
    """In-memory session store backed by a dict.

    Each session holds a YoutubeLiveCaptionSender instance plus metadata.
    A periodic cleanup thread removes idle sessions and calls sender.end().

    Thread-safe: all mutations are protected by a reentrant lock.
    """

    def __init__(
        self,
        session_ttl: int = DEFAULT_SESSION_TTL,
        cleanup_interval: int = DEFAULT_CLEANUP_INTERVAL,
    ) -> None:
        self._sessions: dict[str, dict] = {}
        self._lock = threading.RLock()
        self._session_ttl = session_ttl
        self._cleanup_interval = cleanup_interval
        self._stop_event = threading.Event()
        self._cleanup_thread: Optional[threading.Thread] = None
        if cleanup_interval > 0:
            self._start_cleanup()

    # -------------------------------------------------------------------------
    # CRUD
    # -------------------------------------------------------------------------

    def create(
        self,
        *,
        api_key: str,
        stream_key: str,
        domain: str,
        jwt: str,
        sender,
        sequence: int = 0,
        sync_offset: int = 0,
    ) -> dict:
        """Create and store a new session.

        Args:
            api_key: The client API key.
            stream_key: The YouTube stream key.
            domain: The registered origin domain.
            jwt: Signed JWT for this session.
            sender: YoutubeLiveCaptionSender instance.
            sequence: Starting sequence number (default 0).
            sync_offset: Initial sync offset in ms (default 0).

        Returns:
            The created session dict.
        """
        session_id = make_session_id(api_key, stream_key, domain)
        now = datetime.now(timezone.utc)
        session = {
            "session_id": session_id,
            "api_key": api_key,
            "stream_key": stream_key,
            "domain": domain,
            "jwt": jwt,
            "sequence": sequence,
            "sync_offset": sync_offset,
            "sender": sender,
            "started_at": time.time(),
            "created_at": now,
            "last_activity_at": now,
        }
        with self._lock:
            self._sessions[session_id] = session
        return session

    def get(self, session_id: str) -> Optional[dict]:
        """Retrieve a session by ID."""
        with self._lock:
            return self._sessions.get(session_id)

    def has(self, session_id: str) -> bool:
        """Check whether a session exists."""
        with self._lock:
            return session_id in self._sessions

    def get_by_domain(self, domain: str) -> list[dict]:
        """Get all sessions whose domain matches the given origin."""
        with self._lock:
            return [s for s in self._sessions.values() if s["domain"] == domain]

    def remove(self, session_id: str) -> Optional[dict]:
        """Remove a session and return it, or None if not found."""
        with self._lock:
            return self._sessions.pop(session_id, None)

    def all(self) -> list[dict]:
        """Return a snapshot list of all sessions."""
        with self._lock:
            return list(self._sessions.values())

    def touch(self, session_id: str) -> None:
        """Update last_activity_at for a session."""
        with self._lock:
            session = self._sessions.get(session_id)
            if session:
                session["last_activity_at"] = datetime.now(timezone.utc)

    def size(self) -> int:
        """Return the number of active sessions."""
        with self._lock:
            return len(self._sessions)

    # -------------------------------------------------------------------------
    # Cleanup
    # -------------------------------------------------------------------------

    def _start_cleanup(self) -> None:
        self._cleanup_thread = threading.Thread(
            target=self._cleanup_loop, daemon=True, name="lcyt-session-cleanup"
        )
        self._cleanup_thread.start()

    def _cleanup_loop(self) -> None:
        while not self._stop_event.wait(self._cleanup_interval):
            self._sweep()

    def _sweep(self) -> None:
        cutoff = time.time() - self._session_ttl
        with self._lock:
            expired = [
                sid
                for sid, session in self._sessions.items()
                if session["last_activity_at"].timestamp() < cutoff
            ]
            for sid in expired:
                session = self._sessions.pop(sid)
                try:
                    session["sender"].end()
                except Exception:
                    pass  # best-effort cleanup

    def stop_cleanup(self) -> None:
        """Stop the periodic cleanup thread. Call during graceful shutdown."""
        self._stop_event.set()
        if self._cleanup_thread:
            self._cleanup_thread.join(timeout=5)
