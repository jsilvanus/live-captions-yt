"""YouTube Live Caption Sender."""

import http.client
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse, urlencode

from .config import DEFAULT_BASE_URL, build_ingestion_url, LCYTConfig
from .errors import NetworkError, ValidationError

logger = logging.getLogger("lcyt")


@dataclass
class Caption:
    """A single caption with text and optional timestamp."""

    text: str
    timestamp: str | None = None


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
            verbose: Enable debug logging.
        """
        self._stream_key = stream_key
        self._base_url = base_url
        self._ingestion_url = ingestion_url
        self._region = region
        self._cue = cue
        self._use_region = use_region
        self._sequence = sequence
        self._verbose = verbose

        self._queue: list[Caption] = []
        self._started = False

        if verbose:
            logging.basicConfig(level=logging.DEBUG)
            logger.setLevel(logging.DEBUG)

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
        logger.debug("Sender stopped")
        return self

    def send(self, text: str, timestamp: str | None = None) -> SendResult:
        """Send a single caption.

        Args:
            text: Caption text to send.
            timestamp: Optional ISO format timestamp. Auto-generated if not provided.

        Returns:
            SendResult with sequence, status code, and response.

        Raises:
            ValidationError: If sender not started or text is empty.
            NetworkError: If HTTP request fails.
        """
        self._ensure_started()
        if not text:
            raise ValidationError("Caption text cannot be empty", field="text")

        return self.send_batch([Caption(text=text, timestamp=timestamp)])

    def construct(self, text: str, timestamp: str | None = None) -> int:
        """Queue a caption for batch sending.

        Args:
            text: Caption text to queue.
            timestamp: Optional ISO format timestamp.

        Returns:
            Current queue length.

        Raises:
            ValidationError: If sender not started.
        """
        self._ensure_started()
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

        # Build caption body
        body_parts: list[str] = []
        base_time = datetime.now(timezone.utc)

        for i, caption in enumerate(captions):
            if caption.timestamp:
                ts = self._format_timestamp(caption.timestamp)
            else:
                # Space captions 100ms apart if no timestamp provided
                offset_ms = i * 100
                caption_time = base_time.replace(
                    microsecond=base_time.microsecond + offset_ms * 1000
                )
                ts = self._format_timestamp(caption_time.isoformat())

            body_parts.append(self._build_caption_body(ts, caption.text))

        body = "\n".join(body_parts) + "\n"
        sent_sequence = self._sequence
        result = self._send_post(body, sent_sequence)

        if 200 <= result.status_code < 300:
            self._sequence += 1

        return SendResult(
            sequence=sent_sequence,
            count=len(captions),
            status_code=result.status_code,
            response=result.response,
            server_timestamp=result.server_timestamp,
        )

    def heartbeat(self) -> SendResult:
        """Send a heartbeat to verify connection.

        The heartbeat does not increment the sequence number.

        Returns:
            SendResult with status code and server timestamp.

        Raises:
            ValidationError: If sender not started.
            NetworkError: If HTTP request fails.
        """
        self._ensure_started()
        result = self._send_post("", self._sequence)
        return SendResult(
            sequence=self._sequence,
            status_code=result.status_code,
            response=result.response,
            server_timestamp=result.server_timestamp,
        )

    def send_test(self) -> SendResult:
        """Send a test payload using Google's example format.

        Returns:
            SendResult with status code and response.

        Raises:
            ValidationError: If sender not started.
            NetworkError: If HTTP request fails.
        """
        self._ensure_started()
        test_body = (
            "2012-01-01T10:00:00.000 [region:reg1#cue1]\n"
            "Never gonna give you up\n"
            "\n"
            "2012-01-01T10:00:01.000 [region:reg1#cue1]\n"
            "Never gonna let you down\n"
            "\n"
            "2012-01-01T10:00:02.000 [region:reg1#cue1]\n"
            "Never gonna run around and desert you\n"
        )
        return self._send_post(test_body, self._sequence)

    def get_queue(self) -> list[Caption]:
        """Get a copy of the current caption queue.

        Returns:
            Copy of the caption queue.
        """
        return self._queue.copy()

    def clear_queue(self) -> int:
        """Clear all queued captions.

        Returns:
            Number of captions cleared.
        """
        count = len(self._queue)
        self._queue.clear()
        return count

    def get_sequence(self) -> int:
        """Get the current sequence number.

        Returns:
            Current sequence number.
        """
        return self._sequence

    def set_sequence(self, sequence: int) -> "YoutubeLiveCaptionSender":
        """Set the sequence number manually.

        Args:
            sequence: New sequence number.

        Returns:
            Self for method chaining.
        """
        self._sequence = sequence
        return self

    @property
    def is_started(self) -> bool:
        """Check if sender is started."""
        return self._started

    def _ensure_started(self) -> None:
        """Ensure sender is started."""
        if not self._started:
            raise ValidationError("Sender not started. Call start() first.")

    def _format_timestamp(self, timestamp: str) -> str:
        """Format timestamp for YouTube API.

        YouTube expects format: YYYY-MM-DDTHH:MM:SS.mmm (milliseconds, no timezone)

        Args:
            timestamp: ISO format timestamp.

        Returns:
            Formatted timestamp string.
        """
        # Remove 'Z' suffix if present (YouTube expects no timezone)
        if timestamp.endswith("Z"):
            timestamp = timestamp[:-1]
        # Remove +00:00 timezone if present
        if "+" in timestamp:
            timestamp = timestamp.split("+")[0]
        # Truncate to milliseconds (3 decimal places) - YouTube can't parse microseconds
        if "." in timestamp:
            base, frac = timestamp.rsplit(".", 1)
            timestamp = f"{base}.{frac[:3]}"
        return timestamp

    def _build_caption_body(self, timestamp: str, text: str) -> str:
        """Build the caption body for a single caption.

        Args:
            timestamp: Formatted timestamp.
            text: Caption text.

        Returns:
            Formatted caption body.
        """
        if self._use_region:
            return f"{timestamp} [region:{self._region}#{self._cue}]\n{text}"
        return f"{timestamp}\n{text}"

    def _build_request_url(self, sequence: int) -> str:
        """Build the request URL with sequence parameter.

        Args:
            sequence: Sequence number.

        Returns:
            Full request URL.
        """
        separator = "&" if "?" in self._url else "?"
        return f"{self._url}{separator}seq={sequence}"

    def _send_post(self, body: str, sequence: int) -> SendResult:
        """Send HTTP POST request to YouTube.

        Args:
            body: Request body.
            sequence: Sequence number for URL.

        Returns:
            SendResult with status code and response.

        Raises:
            NetworkError: If request fails.
        """
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

            headers = {
                "Content-Type": "text/plain",
                "Content-Length": str(len(body.encode("utf-8"))),
            }

            conn.request("POST", path, body.encode("utf-8"), headers)
            response = conn.getresponse()
            response_body = response.read().decode("utf-8")
            conn.close()

            logger.debug(f"Response: {response.status} {response_body}")

            # Extract server timestamp from response if available
            server_timestamp = response_body.strip() if response_body else None

            return SendResult(
                sequence=sequence,
                status_code=response.status,
                response=response_body,
                server_timestamp=server_timestamp,
            )

        except Exception as e:
            raise NetworkError(f"HTTP request failed: {e}") from e
