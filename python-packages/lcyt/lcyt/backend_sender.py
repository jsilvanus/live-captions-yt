"""Backend relay caption sender — communicates with lcyt-backend instead of YouTube directly."""

import json
import urllib.error
import urllib.request
from typing import Any

from .errors import NetworkError


class BackendCaptionSender:
    """Send live captions via an lcyt-backend relay server.

    Mirrors the ``YoutubeLiveCaptionSender`` API but communicates with an
    ``lcyt-backend`` HTTP server instead of directly with YouTube. This is
    useful when YouTube's API is not reachable from the client (e.g. browser
    environments blocked by CORS, or Python scripts on a restricted network).

    Example:
        >>> sender = BackendCaptionSender(
        ...     backend_url="https://captions.example.com",
        ...     api_key="a1b2c3d4-...",
        ...     stream_key="YOUR_YOUTUBE_KEY",
        ... )
        >>> sender.start()
        >>> sender.send("Hello!")
        >>> sender.send("Relative", time=5000)  # 5 sec since session start
        >>> result = sender.sync()
        >>> status = sender.heartbeat()
        >>> sender.end()
    """

    def __init__(
        self,
        backend_url: str,
        api_key: str,
        stream_key: str,
        domain: str = "http://localhost",
        sequence: int = 0,
        verbose: bool = False,
    ):
        """Initialize the backend relay sender.

        Args:
            backend_url: Base URL of the lcyt-backend server
                         (e.g. ``"https://captions.example.com"``).
            api_key: API key registered in the backend's SQLite database.
            stream_key: YouTube stream key.
            domain: CORS origin that the session will be associated with.
                    Defaults to ``"http://localhost"``.
            sequence: Starting sequence number (overridden by server on start()).
            verbose: Enable verbose logging.
        """
        self._backend_url = backend_url.rstrip("/")
        self._api_key = api_key
        self._stream_key = stream_key
        self._domain = domain
        self._sequence = sequence
        self._verbose = verbose

        self._is_started = False
        self._sync_offset: int = 0
        self._started_at: float = 0.0
        self._token: str | None = None
        self._queue: list[dict] = []

    # ------------------------------------------------------------------
    # Internal fetch helper
    # ------------------------------------------------------------------

    def _fetch(
        self,
        path: str,
        method: str = "GET",
        body: dict | None = None,
        auth: bool = True,
    ) -> dict:
        """Make a JSON request to the backend.

        Args:
            path: Endpoint path (e.g. ``"/live"``).
            method: HTTP method.
            body: Request body (serialised to JSON).
            auth: Attach ``Authorization: Bearer`` header if token is available.

        Returns:
            Parsed JSON response dict.

        Raises:
            NetworkError: On non-2xx response or network failure.
        """
        url = f"{self._backend_url}{path}"
        data = json.dumps(body).encode() if body is not None else None

        headers = {"Content-Type": "application/json"}
        if auth and self._token:
            headers["Authorization"] = f"Bearer {self._token}"

        req = urllib.request.Request(url, data=data, headers=headers, method=method)

        try:
            with urllib.request.urlopen(req) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as exc:
            try:
                error_body = json.loads(exc.read())
                msg = error_body.get("error", f"HTTP {exc.code}")
            except Exception:
                msg = f"HTTP {exc.code}"
            raise NetworkError(msg, exc.code) from exc
        except Exception as exc:
            raise NetworkError(str(exc)) from exc

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self) -> "BackendCaptionSender":
        """Register a session with the backend and obtain a JWT.

        Updates ``sequence``, ``sync_offset``, and ``started_at`` from the
        server response. Idempotent — if a session already exists the server
        returns the existing JWT.

        Returns:
            Self for method chaining.

        Raises:
            NetworkError: If the registration request fails.
        """
        data = self._fetch(
            "/live",
            method="POST",
            body={
                "apiKey": self._api_key,
                "streamKey": self._stream_key,
                "domain": self._domain,
                "sequence": self._sequence,
            },
            auth=False,
        )

        self._token = data["token"]
        self._sequence = data["sequence"]
        self._sync_offset = data["syncOffset"]
        self._started_at = data["startedAt"]
        self._is_started = True

        return self

    def end(self) -> "BackendCaptionSender":
        """Tear down the backend session and clear the stored JWT.

        Returns:
            Self for method chaining.

        Raises:
            NetworkError: If the request fails.
        """
        self._fetch("/live", method="DELETE")
        self._token = None
        self._is_started = False
        return self

    # ------------------------------------------------------------------
    # Caption sending
    # ------------------------------------------------------------------

    def send(
        self,
        text: str,
        timestamp: str | None = None,
        time: int | None = None,
    ) -> dict:
        """Send a single caption.

        Args:
            text: Caption text.
            timestamp: Absolute timestamp string (ISO format). Mutually exclusive
                       with ``time``.
            time: Milliseconds since session start. Resolved server-side using
                  ``startedAt + time + syncOffset``. Mutually exclusive with
                  ``timestamp``.

        Returns:
            Backend response dict: ``{sequence, timestamp, statusCode, serverTimestamp}``.

        Raises:
            NetworkError: If the request fails.
        """
        caption: dict[str, Any] = {"text": text}
        if time is not None:
            caption["time"] = time
        elif timestamp is not None:
            caption["timestamp"] = timestamp

        data = self._fetch("/captions", method="POST", body={"captions": [caption]})
        self._sequence = data.get("sequence", self._sequence)
        return data

    def send_batch(self, captions: list[dict] | None = None) -> dict:
        """Send multiple captions in one request.

        If ``captions`` is None, drains and sends the internal queue built
        with ``construct()``.

        Args:
            captions: List of caption dicts. Each may have ``text``,
                      ``timestamp`` (ISO string), or ``time`` (ms since start).
                      If None, the internal queue is used.

        Returns:
            Backend response dict: ``{sequence, count, statusCode, serverTimestamp}``.

        Raises:
            NetworkError: If the request fails.
        """
        if captions is None:
            items = list(self._queue)
            self._queue.clear()
        else:
            items = captions

        data = self._fetch("/captions", method="POST", body={"captions": items})
        self._sequence = data.get("sequence", self._sequence)
        return data

    # ------------------------------------------------------------------
    # Local queue (construct / send_batch pattern)
    # ------------------------------------------------------------------

    def construct(
        self,
        text: str,
        timestamp: str | None = None,
        time: int | None = None,
    ) -> int:
        """Add a caption to the local queue without sending.

        Call ``send_batch()`` (with no arguments) to flush the queue.

        Args:
            text: Caption text.
            timestamp: Optional absolute timestamp string.
            time: Optional ms-since-session-start offset.

        Returns:
            Current queue length.
        """
        item: dict[str, Any] = {"text": text}
        if time is not None:
            item["time"] = time
        elif timestamp is not None:
            item["timestamp"] = timestamp
        self._queue.append(item)
        return len(self._queue)

    def get_queue(self) -> list[dict]:
        """Return a copy of the current local queue."""
        return list(self._queue)

    def clear_queue(self) -> int:
        """Clear the local queue.

        Returns:
            Number of items cleared.
        """
        count = len(self._queue)
        self._queue.clear()
        return count

    # ------------------------------------------------------------------
    # Sync and heartbeat
    # ------------------------------------------------------------------

    def sync(self) -> dict:
        """Trigger an NTP-style clock sync on the backend.

        Updates local ``sync_offset`` from the response.

        Returns:
            dict: ``{syncOffset, roundTripTime, serverTimestamp, statusCode}``.

        Raises:
            NetworkError: If the request fails.
        """
        data = self._fetch("/sync", method="POST")
        self._sync_offset = data.get("syncOffset", self._sync_offset)
        return data

    def heartbeat(self) -> dict:
        """Check session status on the backend.

        Updates local ``sequence`` and ``sync_offset``.

        Returns:
            dict: ``{sequence, syncOffset}``.

        Raises:
            NetworkError: If the request fails.
        """
        data = self._fetch("/live")
        self._sequence = data.get("sequence", self._sequence)
        self._sync_offset = data.get("syncOffset", self._sync_offset)
        return data

    # ------------------------------------------------------------------
    # Getters / setters
    # ------------------------------------------------------------------

    def get_sequence(self) -> int:
        """Get the current sequence number."""
        return self._sequence

    def set_sequence(self, seq: int) -> "BackendCaptionSender":
        """Set the sequence number manually."""
        self._sequence = seq
        return self

    def get_sync_offset(self) -> int:
        """Get the current sync offset in milliseconds."""
        return self._sync_offset

    def set_sync_offset(self, offset: int) -> "BackendCaptionSender":
        """Set the sync offset manually."""
        self._sync_offset = offset
        return self

    def get_started_at(self) -> float:
        """Get the session start timestamp (Unix epoch seconds from server)."""
        return self._started_at

    @property
    def is_started(self) -> bool:
        """Check if the session is active."""
        return self._is_started
