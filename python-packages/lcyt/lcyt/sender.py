"""YouTube Live Caption Sender."""

import http.client
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlparse

from .config import DEFAULT_BASE_URL, build_ingestion_url, LCYTConfig
from .errors import NetworkError, ValidationError

logger = logging.getLogger("lcyt")


@dataclass
class Caption:
    """A single caption with text and optional timestamp."""

    text: str
    timestamp: str | datetime | int | float | None = None


@dataclass
class SendResult:
    """Result of a send operation."""

    sequence: int
    status_code: int
    response: str
    server_timestamp: str | None = None
    timestamp: str | None = None
    count: int | None = None


class YoutubeLiveCaptionSender:
    """Send live captions to YouTube streams.

    This class provides methods to send captions to YouTube's live caption
    ingestion endpoint. It supports single captions, batch sending, and
    queue-based workflows.

    Example:
        >>> sender = YoutubeLiveCaptionSender(stream_key="YOUR_KEY")
        >>> sender.start()
        >>> result = sender.send("Hello, world!")
        >>> sender.end()
    """

    def __init__(
        self,
        stream_key: str | None = None,
        base_url: str = DEFAULT_BASE_URL,
        ingestion_url: str | None = None,
        region: str = "reg1",
        cue: str = "cue1",
        use_region: bool = False,
        sequence: int = 0,
        use_sync_offset: bool = False,
        verbose: bool = False,
    ):
        """Initialize the caption sender.

        Args:
            stream_key: YouTube stream key (cid parameter).
            base_url: Base URL for the ingestion endpoint.
            ingestion_url: Full ingestion URL (overrides stream_key + base_url).
            region: Region identifier for captions.
            cue: Cue identifier for captions.
            use_region: Whether to include region/cue in caption body.
            sequence: Starting sequence number.
            use_sync_offset: Apply syncOffset to auto-generated timestamps.
                             Set automatically to True after calling sync().
            verbose: Enable debug logging.
        """
        self._stream_key = stream_key
        self._base_url = base_url
        self._ingestion_url = ingestion_url
        self._region = region
        self._cue = cue
        self._use_region = use_region
        self._sequence = sequence
        self._sync_offset: int = 0   # Clock offset in ms (positive = server ahead)
        self._use_sync_offset = use_sync_offset
        self._verbose = verbose

        self._queue: list[Caption] = []
        self._started = False

        if verbose:
            logging.basicConfig(level=logging.DEBUG)
            logger.setLevel(logging.DEBUG)

    # ------------------------------------------------------------------
    # Internal time helper
    # ------------------------------------------------------------------

    def _now_ms(self) -> float:
        """Return current time in epoch milliseconds, adjusted by sync offset."""
        return time.time() * 1000 + (self._sync_offset if self._use_sync_offset else 0)

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self) -> "YoutubeLiveCaptionSender":
        """Initialize the sender. Must be called before sending captions.

        Returns:
            Self for method chaining.

        Raises:
            ValidationError: If stream_key or ingestion_url is not set.
        """
        if self._ingestion_url:
            self._url = self._ingestion_url
        elif self._stream_key:
            config = LCYTConfig(
                stream_key=self._stream_key,
                base_url=self._base_url,
            )
            self._url = build_ingestion_url(config)
        else:
            raise ValidationError(
                "Either stream_key or ingestion_url must be provided",
                field="stream_key",
            )

        self._started = True
        logger.debug(f"Sender started with URL: {self._url}")
        return self

    def end(self) -> "YoutubeLiveCaptionSender":
        """Stop the sender and cleanup.

        Returns:
            Self for method chaining.
        """
        self._started = False
        self._queue.clear()
        logger.debug(f"Caption sender stopped. Total captions sent: {self._sequence}")
        return self

    # ------------------------------------------------------------------
    # Sending
    # ------------------------------------------------------------------

    def send(self, text: str, timestamp: str | datetime | int | float | None = None) -> SendResult:
        """Send a single caption.

        Args:
            text: Caption text to send.
            timestamp: Optional timestamp. Accepted forms:

                - ``datetime`` object (timezone-aware or naive UTC)
                - ``int``/``float`` >= 1000: Unix epoch in seconds (``time.time()`` style)
                - ``int``/``float`` < 1000 or negative: relative offset in seconds from now
                  (e.g. ``-2`` = 2 seconds ago). Sync offset is applied when enabled.
                - ISO string ``YYYY-MM-DDTHH:MM:SS.mmm`` (used as-is)
                - ISO string with trailing ``Z`` or ``+00:00`` (auto-stripped)
                - ``None``: auto-generated current time (sync offset applied if enabled)

        Returns:
            SendResult. The ``timestamp`` field is set to the formatted string sent.

        Raises:
            ValidationError: If sender not started or text is empty.
            NetworkError: If HTTP request fails.
        """
        self._ensure_started()
        if not text:
            raise ValidationError("Caption text cannot be empty", field="text")

        result = self.send_batch([Caption(text=text, timestamp=timestamp)])
        # Populate the timestamp field to mirror Node.js send() return shape
        if timestamp is not None:
            result.timestamp = self._format_timestamp(timestamp)
        return result

    def construct(self, text: str, timestamp: str | datetime | int | float | None = None) -> int:
        """Queue a caption for batch sending.

        Args:
            text: Caption text to queue.
            timestamp: Optional timestamp. Accepts the same forms as ``send()``.

        Returns:
            Current queue length.

        Raises:
            ValidationError: If sender not started or text is empty/not a string.
        """
        self._ensure_started()
        if not text or not isinstance(text, str):
            raise ValidationError("Caption text is required and must be a string.", field="text")
        self._queue.append(Caption(text=text, timestamp=timestamp))
        logger.debug(f"Caption queued, queue length: {len(self._queue)}")
        return len(self._queue)

    def send_batch(self, captions: list[Caption] | None = None) -> SendResult:
        """Send a batch of captions.

        Args:
            captions: List of captions to send. If None, sends queued captions.

        Returns:
            SendResult with sequence, count, status code, and response.

        Raises:
            ValidationError: If sender not started or no captions to send.
            NetworkError: If HTTP request fails.
        """
        self._ensure_started()

        if captions is None:
            captions = self._queue.copy()
            self._queue.clear()

        if not captions:
            raise ValidationError("No captions to send")

        body_parts: list[str] = []
        base_time_ms = self._now_ms()

        for i, caption in enumerate(captions):
            if caption.timestamp:
                ts = self._format_timestamp(caption.timestamp)
            else:
                # Space captions 100ms apart if no timestamp provided.
                caption_time = datetime.fromtimestamp(
                    (base_time_ms + i * 100) / 1000, tz=timezone.utc
                )
                ts = self._format_timestamp(caption_time)

            body_parts.append(self._build_caption_body(ts, caption.text))

        body = "\n".join(body_parts) + "\n"
        sent_sequence = self._sequence
        result = self._send_post(body, sent_sequence)

        if 200 <= result.status_code < 300:
            self._sequence += 1
            logger.debug(f"Sent batch #{sent_sequence}: {len(captions)} caption(s)")
        else:
            logger.debug(f"Batch #{sent_sequence} returned status {result.status_code}")

        return SendResult(
            sequence=sent_sequence,
            count=len(captions),
            status_code=result.status_code,
            response=result.response,
            server_timestamp=result.server_timestamp,
        )

    def heartbeat(self) -> SendResult:
        """Send a heartbeat (empty POST) to verify connection.

        The heartbeat does not increment the sequence number per Google's spec.

        Returns:
            SendResult with status code and server timestamp.

        Raises:
            ValidationError: If sender not started.
            NetworkError: If HTTP request fails.
        """
        self._ensure_started()
        result = self._send_post("", self._sequence)
        if 200 <= result.status_code < 300:
            logger.debug(f"Heartbeat #{self._sequence} OK")
        else:
            logger.debug(f"Heartbeat #{self._sequence} returned status {result.status_code}")
        return SendResult(
            sequence=self._sequence,
            status_code=result.status_code,
            response=result.response,
            server_timestamp=result.server_timestamp,
        )

    def sync(self) -> dict:
        """Synchronize the local clock with YouTube's server clock (NTP-style).

        Sends a heartbeat, measures round-trip time, computes the midpoint
        estimate of server time, and stores the offset as ``sync_offset``.
        Automatically enables ``use_sync_offset`` so future auto-generated
        timestamps are corrected.

        Returns:
            dict with keys:
                ``sync_offset`` (int ms), ``round_trip_time`` (int ms),
                ``server_timestamp`` (str | None), ``status_code`` (int).

        Raises:
            ValidationError: If sender not started.
            NetworkError: If HTTP request fails.
        """
        self._ensure_started()

        t1_wall_ms = time.time() * 1000
        result = self.heartbeat()
        t2_wall_ms = time.time() * 1000
        rtt_ms = int(t2_wall_ms - t1_wall_ms)

        if not result.server_timestamp:
            logger.debug("No server timestamp in heartbeat response — syncOffset not updated")
            return {
                "sync_offset": self._sync_offset,
                "round_trip_time": rtt_ms,
                "server_timestamp": None,
                "status_code": result.status_code,
            }

        # Parse server timestamp (format: YYYY-MM-DDTHH:MM:SS.mmm — no Z, treat as UTC)
        server_time_ms = (
            datetime.fromisoformat(result.server_timestamp)
            .replace(tzinfo=timezone.utc)
            .timestamp()
        ) * 1000

        local_estimate_ms = (t1_wall_ms + t2_wall_ms) / 2
        self._sync_offset = round(server_time_ms - local_estimate_ms)
        self._use_sync_offset = True

        logger.debug(f"Synced: offset {self._sync_offset}ms, RTT {rtt_ms}ms")

        return {
            "sync_offset": self._sync_offset,
            "round_trip_time": rtt_ms,
            "server_timestamp": result.server_timestamp,
            "status_code": result.status_code,
        }

    def send_test(self) -> SendResult:
        """Send a test payload using current timestamps.

        Uses the ``region:reg1#cue1`` format from Google's documentation.

        Returns:
            SendResult with status code and response.

        Raises:
            ValidationError: If sender not started.
            NetworkError: If HTTP request fails.
        """
        self._ensure_started()

        now_ms = self._now_ms()
        ts1 = self._format_timestamp(datetime.fromtimestamp(now_ms / 1000, tz=timezone.utc))
        ts2 = self._format_timestamp(
            datetime.fromtimestamp((now_ms + 100) / 1000, tz=timezone.utc)
        )

        body = (
            f"{ts1} region:reg1#cue1\n"
            "HELLO\n"
            f"{ts2} region:reg1#cue1\n"
            "WORLD\n"
        )

        sent_sequence = self._sequence
        result = self._send_post(body, sent_sequence)

        if 200 <= result.status_code < 300:
            self._sequence += 1
            logger.debug(f"Test sent #{sent_sequence}")
        else:
            logger.debug(f"Test #{sent_sequence} returned status {result.status_code}")

        return result

    # ------------------------------------------------------------------
    # Queue helpers
    # ------------------------------------------------------------------

    def get_queue(self) -> list[Caption]:
        """Get a copy of the current caption queue."""
        return self._queue.copy()

    def clear_queue(self) -> int:
        """Clear all queued captions.

        Returns:
            Number of captions cleared.
        """
        count = len(self._queue)
        self._queue.clear()
        logger.debug(f"Cleared {count} caption(s) from queue")
        return count

    # ------------------------------------------------------------------
    # Sequence management
    # ------------------------------------------------------------------

    def get_sequence(self) -> int:
        """Get the current sequence number."""
        return self._sequence

    def set_sequence(self, sequence: int) -> "YoutubeLiveCaptionSender":
        """Set the sequence number manually."""
        self._sequence = sequence
        return self

    # ------------------------------------------------------------------
    # Sync offset management
    # ------------------------------------------------------------------

    def get_sync_offset(self) -> int:
        """Get the current sync offset in milliseconds.

        Returns:
            Clock offset in ms (positive = server ahead of local).
        """
        return self._sync_offset

    def set_sync_offset(self, offset: int) -> "YoutubeLiveCaptionSender":
        """Set the sync offset manually (e.g. to restore a previously computed offset).

        Args:
            offset: Clock offset in ms.

        Returns:
            Self for method chaining.
        """
        self._sync_offset = offset
        return self

    @property
    def is_started(self) -> bool:
        """Check if sender is started."""
        return self._started

    # ------------------------------------------------------------------
    # Private implementation
    # ------------------------------------------------------------------

    def _ensure_started(self) -> None:
        if not self._started:
            raise ValidationError("Sender not started. Call start() first.")

    def _format_timestamp(self, timestamp: str | datetime | int | float) -> str:
        """Format timestamp for YouTube API.

        YouTube expects: YYYY-MM-DDTHH:MM:SS.mmm (milliseconds, no timezone suffix)

        Accepted inputs:
        - ``datetime``: converted via isoformat()
        - ``int``/``float`` >= 1000: Unix epoch in **seconds** (time.time() convention)
        - ``int``/``float`` < 1000 or negative: relative seconds offset from now
          (sync offset applied when use_sync_offset is True)
        - ISO string with or without trailing 'Z' or '+00:00'
        """
        if isinstance(timestamp, datetime):
            timestamp = timestamp.isoformat()
        elif isinstance(timestamp, (int, float)):
            if timestamp < 1000:
                # Relative offset in seconds from now (sync offset applied)
                dt = datetime.fromtimestamp(
                    (self._now_ms() + timestamp * 1000) / 1000, tz=timezone.utc
                )
            else:
                # Unix epoch in seconds (time.time() convention)
                dt = datetime.fromtimestamp(timestamp, tz=timezone.utc)
            timestamp = dt.isoformat()

        # Strip trailing Z
        if timestamp.endswith("Z"):
            timestamp = timestamp[:-1]
        # Strip +00:00 timezone offset
        if "+" in timestamp:
            timestamp = timestamp.split("+")[0]
        # Truncate to milliseconds (3 decimal places) — YouTube rejects microseconds
        if "." in timestamp:
            base, frac = timestamp.rsplit(".", 1)
            timestamp = f"{base}.{frac[:3]}"
        return timestamp

    def _build_caption_body(self, timestamp: str, text: str) -> str:
        """Build the caption body for a single caption.

        Format (with region): ``{ts} region:{region}#{cue}\\n{text}``
        Format (without):     ``{ts}\\n{text}``
        """
        if self._use_region:
            return f"{timestamp} region:{self._region}#{self._cue}\n{text}"
        return f"{timestamp}\n{text}"

    def _build_request_url(self, sequence: int) -> str:
        separator = "&" if "?" in self._url else "?"
        return f"{self._url}{separator}seq={sequence}"

    def _send_post(self, body: str, sequence: int) -> SendResult:
        """Send HTTP POST request to YouTube."""
        url = self._build_request_url(sequence)
        parsed = urlparse(url)

        logger.debug(f"POST {url}")
        logger.debug(f"Body: {body!r}")

        try:
            if parsed.scheme == "https":
                conn = http.client.HTTPSConnection(parsed.netloc, timeout=30)
            else:
                conn = http.client.HTTPConnection(parsed.netloc, timeout=30)

            path = parsed.path
            if parsed.query:
                path = f"{path}?{parsed.query}"

            encoded = body.encode("utf-8")
            headers = {
                "Content-Type": "text/plain",
                "Content-Length": str(len(encoded)),
            }

            conn.request("POST", path, encoded, headers)
            response = conn.getresponse()
            response_body = response.read().decode("utf-8")
            conn.close()

            logger.debug(f"Response: {response.status} {response_body}")

            server_timestamp = response_body.strip() if response_body.strip() else None

            return SendResult(
                sequence=sequence,
                status_code=response.status,
                response=response_body,
                server_timestamp=server_timestamp,
            )

        except Exception as e:
            raise NetworkError(f"HTTP request failed: {e}") from e
