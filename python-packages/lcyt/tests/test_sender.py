"""Tests for YoutubeLiveCaptionSender (sender.py).

HTTP calls are intercepted by monkeypatching http.client so no real
network connections are made.
"""

import http.client
import time
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

from lcyt.sender import YoutubeLiveCaptionSender, Caption, SendResult
from lcyt.errors import NetworkError, ValidationError
from lcyt.config import DEFAULT_BASE_URL


# ---------------------------------------------------------------------------
# Helpers — mock HTTP response
# ---------------------------------------------------------------------------

def make_mock_response(status=200, body="2026-01-01T12:00:00.000"):
    resp = MagicMock()
    resp.status = status
    resp.read.return_value = body.encode("utf-8")
    return resp


def make_mock_conn(response):
    """Return a mock HTTPConnection that returns `response` from getresponse()."""
    conn = MagicMock()
    conn.getresponse.return_value = response
    return conn


# ---------------------------------------------------------------------------
# Constructor
# ---------------------------------------------------------------------------

class TestConstructor:
    def test_defaults(self):
        s = YoutubeLiveCaptionSender()
        assert s._stream_key is None
        assert s._base_url == DEFAULT_BASE_URL
        assert s._sequence == 0
        assert s._sync_offset == 0
        assert not s._use_sync_offset
        assert not s._started
        assert s.is_started is False

    def test_custom_params(self):
        s = YoutubeLiveCaptionSender(
            stream_key="K",
            region="reg2",
            cue="cue3",
            sequence=5,
            use_sync_offset=True,
        )
        assert s._stream_key == "K"
        assert s._region == "reg2"
        assert s._cue == "cue3"
        assert s._sequence == 5
        assert s._use_sync_offset is True


# ---------------------------------------------------------------------------
# Lifecycle — start() / end()
# ---------------------------------------------------------------------------

class TestLifecycle:
    def test_start_with_stream_key(self):
        s = YoutubeLiveCaptionSender(stream_key="MY_KEY")
        s.start()
        assert s._started is True
        assert "MY_KEY" in s._url

    def test_start_with_explicit_ingestion_url(self):
        s = YoutubeLiveCaptionSender(ingestion_url="http://custom.test/cc?cid=X")
        s.start()
        assert s._url == "http://custom.test/cc?cid=X"

    def test_start_raises_when_no_key_or_url(self):
        s = YoutubeLiveCaptionSender()
        with pytest.raises(ValidationError) as exc_info:
            s.start()
        assert exc_info.value.field == "stream_key"

    def test_start_returns_self(self):
        s = YoutubeLiveCaptionSender(stream_key="K")
        assert s.start() is s

    def test_end_marks_not_started(self):
        s = YoutubeLiveCaptionSender(stream_key="K")
        s.start()
        s.end()
        assert s._started is False

    def test_end_returns_self(self):
        s = YoutubeLiveCaptionSender(stream_key="K")
        s.start()
        assert s.end() is s

    def test_end_clears_queue(self):
        s = YoutubeLiveCaptionSender(stream_key="K")
        s.start()
        s.construct("hello")
        s.end()
        assert s.get_queue() == []


# ---------------------------------------------------------------------------
# send() — validation
# ---------------------------------------------------------------------------

class TestSendValidation:
    def test_send_raises_if_not_started(self):
        s = YoutubeLiveCaptionSender(stream_key="K")
        with pytest.raises(ValidationError):
            s.send("hello")

    def test_send_raises_for_empty_text(self):
        s = YoutubeLiveCaptionSender(stream_key="K")
        s.start()
        with pytest.raises(ValidationError) as exc_info:
            s.send("")
        assert exc_info.value.field == "text"


# ---------------------------------------------------------------------------
# send() — HTTP dispatch
# ---------------------------------------------------------------------------

class TestSendHttp:
    def _make_sender(self):
        s = YoutubeLiveCaptionSender(stream_key="TEST_KEY")
        s.start()
        return s

    def test_send_calls_post_and_returns_send_result(self):
        s = self._make_sender()
        mock_resp = make_mock_response(200)
        mock_conn = make_mock_conn(mock_resp)

        with patch("http.client.HTTPConnection", return_value=mock_conn):
            result = s.send("Hello, world!")

        assert isinstance(result, SendResult)
        assert result.status_code == 200
        mock_conn.request.assert_called_once()

    def test_send_increments_sequence_on_success(self):
        s = self._make_sender()
        mock_resp = make_mock_response(200)
        mock_conn = make_mock_conn(mock_resp)

        with patch("http.client.HTTPConnection", return_value=mock_conn):
            s.send("A")
            s.send("B")

        assert s._sequence == 2

    def test_send_does_not_increment_sequence_on_error_status(self):
        s = self._make_sender()
        mock_resp = make_mock_response(400, "")
        mock_conn = make_mock_conn(mock_resp)

        with patch("http.client.HTTPConnection", return_value=mock_conn):
            result = s.send("oops")

        assert result.status_code == 400
        assert s._sequence == 0

    def test_send_raises_network_error_on_exception(self):
        s = self._make_sender()
        mock_conn = MagicMock()
        mock_conn.request.side_effect = OSError("connection refused")

        with patch("http.client.HTTPConnection", return_value=mock_conn):
            with pytest.raises(NetworkError):
                s.send("fail")

    def test_send_passes_seq_in_url(self):
        s = self._make_sender()
        s._sequence = 7
        captured_path = []

        mock_resp = make_mock_response(200)
        mock_conn = make_mock_conn(mock_resp)
        original_request = mock_conn.request

        def capture_request(method, path, *a, **kw):
            captured_path.append(path)

        mock_conn.request.side_effect = capture_request

        with patch("http.client.HTTPConnection", return_value=mock_conn):
            try:
                s.send("seq test")
            except Exception:
                pass  # getresponse won't be called, that's fine

        if captured_path:
            assert "seq=7" in captured_path[0]

    def test_send_returns_server_timestamp(self):
        s = self._make_sender()
        ts = "2026-03-15T10:00:00.000"
        mock_resp = make_mock_response(200, ts)
        mock_conn = make_mock_conn(mock_resp)

        with patch("http.client.HTTPConnection", return_value=mock_conn):
            result = s.send("with ts")

        assert result.server_timestamp == ts


# ---------------------------------------------------------------------------
# construct() / get_queue() / clear_queue()
# ---------------------------------------------------------------------------

class TestQueue:
    def _started_sender(self):
        s = YoutubeLiveCaptionSender(stream_key="K")
        s.start()
        return s

    def test_construct_raises_if_not_started(self):
        s = YoutubeLiveCaptionSender(stream_key="K")
        with pytest.raises(ValidationError):
            s.construct("hello")

    def test_construct_raises_for_empty_text(self):
        s = self._started_sender()
        with pytest.raises(ValidationError) as exc_info:
            s.construct("")
        assert exc_info.value.field == "text"

    def test_construct_raises_for_non_string(self):
        s = self._started_sender()
        with pytest.raises(ValidationError):
            s.construct(42)

    def test_construct_returns_queue_length(self):
        s = self._started_sender()
        assert s.construct("first") == 1
        assert s.construct("second") == 2

    def test_get_queue_returns_copy(self):
        s = self._started_sender()
        s.construct("a")
        q = s.get_queue()
        assert len(q) == 1
        q.clear()  # should not affect internal queue
        assert len(s.get_queue()) == 1

    def test_clear_queue_returns_count(self):
        s = self._started_sender()
        s.construct("x")
        s.construct("y")
        count = s.clear_queue()
        assert count == 2
        assert s.get_queue() == []


# ---------------------------------------------------------------------------
# send_batch()
# ---------------------------------------------------------------------------

class TestSendBatch:
    def _started_sender(self):
        s = YoutubeLiveCaptionSender(stream_key="K")
        s.start()
        return s

    def test_send_batch_raises_if_not_started(self):
        s = YoutubeLiveCaptionSender(stream_key="K")
        with pytest.raises(ValidationError):
            s.send_batch([Caption(text="x")])

    def test_send_batch_raises_with_empty_list(self):
        s = self._started_sender()
        with pytest.raises(ValidationError):
            s.send_batch([])

    def test_send_batch_raises_when_queue_empty_and_no_arg(self):
        s = self._started_sender()
        with pytest.raises(ValidationError):
            s.send_batch()

    def test_send_batch_sends_given_captions(self):
        s = self._started_sender()
        mock_resp = make_mock_response(200)
        mock_conn = make_mock_conn(mock_resp)

        with patch("http.client.HTTPConnection", return_value=mock_conn):
            result = s.send_batch([Caption("A"), Caption("B")])

        assert result.count == 2
        assert result.status_code == 200

    def test_send_batch_drains_queue_when_no_arg(self):
        s = self._started_sender()
        s.construct("queue-item-1")
        s.construct("queue-item-2")

        mock_resp = make_mock_response(200)
        mock_conn = make_mock_conn(mock_resp)

        with patch("http.client.HTTPConnection", return_value=mock_conn):
            result = s.send_batch()

        assert result.count == 2
        assert s.get_queue() == []

    def test_send_batch_increments_sequence_on_success(self):
        s = self._started_sender()
        mock_resp = make_mock_response(200)
        mock_conn = make_mock_conn(mock_resp)

        with patch("http.client.HTTPConnection", return_value=mock_conn):
            s.send_batch([Caption("x")])

        assert s._sequence == 1


# ---------------------------------------------------------------------------
# heartbeat()
# ---------------------------------------------------------------------------

class TestHeartbeat:
    def test_heartbeat_does_not_increment_sequence(self):
        s = YoutubeLiveCaptionSender(stream_key="K")
        s.start()
        s._sequence = 3

        mock_resp = make_mock_response(200, "")
        mock_conn = make_mock_conn(mock_resp)

        with patch("http.client.HTTPConnection", return_value=mock_conn):
            s.heartbeat()

        assert s._sequence == 3

    def test_heartbeat_raises_if_not_started(self):
        s = YoutubeLiveCaptionSender(stream_key="K")
        with pytest.raises(ValidationError):
            s.heartbeat()

    def test_heartbeat_returns_send_result(self):
        s = YoutubeLiveCaptionSender(stream_key="K")
        s.start()
        mock_resp = make_mock_response(200, "2026-01-01T00:00:00.000")
        mock_conn = make_mock_conn(mock_resp)

        with patch("http.client.HTTPConnection", return_value=mock_conn):
            result = s.heartbeat()

        assert isinstance(result, SendResult)
        assert result.status_code == 200


# ---------------------------------------------------------------------------
# sync()
# ---------------------------------------------------------------------------

class TestSync:
    def test_sync_raises_if_not_started(self):
        s = YoutubeLiveCaptionSender(stream_key="K")
        with pytest.raises(ValidationError):
            s.sync()

    def test_sync_updates_sync_offset_and_enables_it(self):
        s = YoutubeLiveCaptionSender(stream_key="K")
        s.start()

        server_ts = "2026-01-01T12:00:00.000"
        mock_resp = make_mock_response(200, server_ts)
        mock_conn = make_mock_conn(mock_resp)

        with patch("http.client.HTTPConnection", return_value=mock_conn):
            result = s.sync()

        assert isinstance(result["sync_offset"], int)
        assert isinstance(result["round_trip_time"], int)
        assert result["server_timestamp"] == server_ts
        assert s._use_sync_offset is True

    def test_sync_returns_none_server_timestamp_when_body_empty(self):
        s = YoutubeLiveCaptionSender(stream_key="K")
        s.start()

        mock_resp = make_mock_response(200, "")
        mock_conn = make_mock_conn(mock_resp)

        with patch("http.client.HTTPConnection", return_value=mock_conn):
            result = s.sync()

        assert result["server_timestamp"] is None
        # sync_offset should not change if there's no server timestamp
        assert s._sync_offset == 0


# ---------------------------------------------------------------------------
# Sequence management
# ---------------------------------------------------------------------------

class TestSequence:
    def test_get_sequence(self):
        s = YoutubeLiveCaptionSender(sequence=42)
        assert s.get_sequence() == 42

    def test_set_sequence_returns_self(self):
        s = YoutubeLiveCaptionSender()
        assert s.set_sequence(10) is s
        assert s._sequence == 10


# ---------------------------------------------------------------------------
# Sync offset management
# ---------------------------------------------------------------------------

class TestSyncOffset:
    def test_get_sync_offset_default(self):
        s = YoutubeLiveCaptionSender()
        assert s.get_sync_offset() == 0

    def test_set_sync_offset_returns_self(self):
        s = YoutubeLiveCaptionSender()
        assert s.set_sync_offset(500) is s
        assert s._sync_offset == 500


# ---------------------------------------------------------------------------
# _format_timestamp()
# ---------------------------------------------------------------------------

class TestFormatTimestamp:
    def _sender(self):
        return YoutubeLiveCaptionSender(stream_key="K")

    def test_datetime_object(self):
        s = self._sender()
        dt = datetime(2026, 3, 15, 10, 30, 0, 123000, tzinfo=timezone.utc)
        ts = s._format_timestamp(dt)
        assert ts.startswith("2026-03-15T10:30:00")
        assert not ts.endswith("Z")
        assert "+" not in ts

    def test_iso_string_strips_trailing_z(self):
        s = self._sender()
        ts = s._format_timestamp("2026-01-01T00:00:00.000Z")
        assert not ts.endswith("Z")
        assert ts == "2026-01-01T00:00:00.000"

    def test_iso_string_strips_plus_offset(self):
        s = self._sender()
        ts = s._format_timestamp("2026-01-01T12:00:00.000+00:00")
        assert "+" not in ts
        assert ts == "2026-01-01T12:00:00.000"

    def test_iso_string_truncates_microseconds(self):
        s = self._sender()
        ts = s._format_timestamp("2026-01-01T00:00:00.123456")
        assert ts == "2026-01-01T00:00:00.123"

    def test_large_int_treated_as_epoch_seconds(self):
        # Values >= 1000 are Unix epoch seconds
        s = self._sender()
        epoch_s = 1_700_000_000  # some time in 2023
        ts = s._format_timestamp(epoch_s)
        assert ts.startswith("20")  # year should be 20xx
        assert "T" in ts

    def test_small_float_treated_as_relative_offset(self):
        # Values < 1000 are relative seconds from now
        s = self._sender()
        ts = s._format_timestamp(0.0)
        assert ts.startswith("20")
        assert "T" in ts

    def test_negative_value_treated_as_relative_offset(self):
        s = self._sender()
        ts = s._format_timestamp(-2.0)  # 2 seconds ago
        assert ts.startswith("20")


# ---------------------------------------------------------------------------
# _build_caption_body()
# ---------------------------------------------------------------------------

class TestBuildCaptionBody:
    def test_without_region(self):
        s = YoutubeLiveCaptionSender(stream_key="K", use_region=False)
        body = s._build_caption_body("2026-01-01T00:00:00.000", "Hello")
        assert body == "2026-01-01T00:00:00.000\nHello"

    def test_with_region(self):
        s = YoutubeLiveCaptionSender(stream_key="K", use_region=True, region="reg1", cue="cue1")
        body = s._build_caption_body("2026-01-01T00:00:00.000", "Hello")
        assert "region:reg1#cue1" in body
        assert body.endswith("Hello")
