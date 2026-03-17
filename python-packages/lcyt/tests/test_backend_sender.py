"""Tests for BackendCaptionSender (backend_sender.py).

HTTP calls are intercepted by monkeypatching urllib.request so no real
network connections are made.
"""

import json
from unittest.mock import MagicMock, patch
import urllib.error
import urllib.request

import pytest

from lcyt.backend_sender import BackendCaptionSender
from lcyt.errors import NetworkError


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_sender(**kwargs):
    defaults = dict(
        backend_url="http://backend.test",
        api_key="test-api-key",
        stream_key="stream-key-123",
        domain="https://example.com",
    )
    defaults.update(kwargs)
    return BackendCaptionSender(**defaults)


def _make_urlopen_response(data: dict):
    """Return a context-manager mock that yields a response with `data`."""
    body = json.dumps(data).encode()
    resp = MagicMock()
    resp.read.return_value = body
    ctx = MagicMock()
    ctx.__enter__ = MagicMock(return_value=resp)
    ctx.__exit__ = MagicMock(return_value=False)
    return ctx


def _make_http_error(code: int, body: dict | None = None):
    body_bytes = json.dumps(body or {}).encode() if body else b""
    err = urllib.error.HTTPError(
        url="http://backend.test/live",
        code=code,
        msg=f"HTTP {code}",
        hdrs=None,
        fp=MagicMock(read=MagicMock(return_value=body_bytes)),
    )
    return err


# ---------------------------------------------------------------------------
# Constructor
# ---------------------------------------------------------------------------

class TestConstructor:
    def test_strips_trailing_slash(self):
        s = _make_sender(backend_url="http://backend.test/")
        assert s._backend_url == "http://backend.test"

    def test_defaults(self):
        s = _make_sender()
        assert s._token is None
        assert s._is_started is False
        assert s._sequence == 0
        assert s._sync_offset == 0
        assert s._started_at == 0.0
        assert s.get_queue() == []

    def test_is_started_property(self):
        s = _make_sender()
        assert s.is_started is False


# ---------------------------------------------------------------------------
# start()
# ---------------------------------------------------------------------------

class TestStart:
    def test_start_posts_to_live_and_stores_token(self):
        s = _make_sender()
        resp_data = {
            "token": "jwt.token.here",
            "sequence": 5,
            "syncOffset": 100,
            "startedAt": 1700000000.0,
        }
        with patch("urllib.request.urlopen", return_value=_make_urlopen_response(resp_data)):
            s.start()

        assert s._token == "jwt.token.here"
        assert s._sequence == 5
        assert s._sync_offset == 100
        assert s._started_at == 1700000000.0
        assert s._is_started is True

    def test_start_returns_self(self):
        s = _make_sender()
        resp_data = {"token": "t", "sequence": 0, "syncOffset": 0, "startedAt": 0.0}
        with patch("urllib.request.urlopen", return_value=_make_urlopen_response(resp_data)):
            result = s.start()
        assert result is s

    def test_start_raises_network_error_on_http_error(self):
        s = _make_sender()
        with patch("urllib.request.urlopen", side_effect=_make_http_error(401)):
            with pytest.raises(NetworkError):
                s.start()

    def test_start_raises_network_error_on_connection_failure(self):
        s = _make_sender()
        with patch("urllib.request.urlopen", side_effect=OSError("refused")):
            with pytest.raises(NetworkError):
                s.start()


# ---------------------------------------------------------------------------
# end()
# ---------------------------------------------------------------------------

class TestEnd:
    def _started_sender(self):
        s = _make_sender()
        s._token = "jwt"
        s._is_started = True
        return s

    def test_end_clears_token(self):
        s = self._started_sender()
        with patch("urllib.request.urlopen", return_value=_make_urlopen_response({})):
            s.end()
        assert s._token is None
        assert s._is_started is False

    def test_end_returns_self(self):
        s = self._started_sender()
        with patch("urllib.request.urlopen", return_value=_make_urlopen_response({})):
            result = s.end()
        assert result is s

    def test_end_raises_network_error_on_failure(self):
        s = self._started_sender()
        with patch("urllib.request.urlopen", side_effect=_make_http_error(404)):
            with pytest.raises(NetworkError):
                s.end()


# ---------------------------------------------------------------------------
# send()
# ---------------------------------------------------------------------------

class TestSend:
    def _started_sender(self):
        s = _make_sender()
        s._token = "jwt"
        s._is_started = True
        return s

    def test_send_posts_to_captions(self):
        s = self._started_sender()
        resp_data = {"ok": True, "requestId": "r1", "sequence": 1}
        with patch("urllib.request.urlopen", return_value=_make_urlopen_response(resp_data)) as mock_open:
            result = s.send("Hello!")
        assert result["ok"] is True

    def test_send_updates_sequence(self):
        s = self._started_sender()
        resp_data = {"ok": True, "requestId": "r1", "sequence": 3}
        with patch("urllib.request.urlopen", return_value=_make_urlopen_response(resp_data)):
            s.send("test")
        assert s._sequence == 3

    def test_send_with_timestamp(self):
        s = self._started_sender()
        captured = []

        def capture_urlopen(req):
            captured.append(json.loads(req.data))
            return _make_urlopen_response({"ok": True, "sequence": 0})

        with patch("urllib.request.urlopen", side_effect=capture_urlopen):
            s.send("hello", timestamp="2026-01-01T00:00:00.000")

        assert captured[0]["captions"][0]["timestamp"] == "2026-01-01T00:00:00.000"

    def test_send_with_time(self):
        s = self._started_sender()
        captured = []

        def capture_urlopen(req):
            captured.append(json.loads(req.data))
            return _make_urlopen_response({"ok": True, "sequence": 0})

        with patch("urllib.request.urlopen", side_effect=capture_urlopen):
            s.send("hello", time=1500)

        assert captured[0]["captions"][0]["time"] == 1500

    def test_send_raises_network_error_on_http_error(self):
        s = self._started_sender()
        with patch("urllib.request.urlopen", side_effect=_make_http_error(400)):
            with pytest.raises(NetworkError):
                s.send("bad")


# ---------------------------------------------------------------------------
# send_batch()
# ---------------------------------------------------------------------------

class TestSendBatch:
    def _started_sender(self):
        s = _make_sender()
        s._token = "jwt"
        s._is_started = True
        return s

    def test_send_batch_with_list(self):
        s = self._started_sender()
        resp_data = {"ok": True, "requestId": "r1", "sequence": 2, "count": 2}
        with patch("urllib.request.urlopen", return_value=_make_urlopen_response(resp_data)):
            result = s.send_batch([{"text": "A"}, {"text": "B"}])
        assert result["count"] == 2

    def test_send_batch_drains_queue(self):
        s = self._started_sender()
        s.construct("x")
        s.construct("y")

        captured = []

        def capture(req):
            captured.append(json.loads(req.data))
            return _make_urlopen_response({"ok": True, "sequence": 1})

        with patch("urllib.request.urlopen", side_effect=capture):
            s.send_batch()

        assert len(captured[0]["captions"]) == 2
        assert s.get_queue() == []

    def test_send_batch_empty_list_still_posts(self):
        s = self._started_sender()
        resp_data = {"ok": True, "sequence": 0}
        with patch("urllib.request.urlopen", return_value=_make_urlopen_response(resp_data)):
            # An empty explicit list should still make the HTTP call
            result = s.send_batch([])
        assert result is not None


# ---------------------------------------------------------------------------
# construct() / get_queue() / clear_queue()
# ---------------------------------------------------------------------------

class TestQueue:
    def test_construct_adds_to_queue(self):
        s = _make_sender()
        count = s.construct("hello")
        assert count == 1
        assert s.get_queue()[0]["text"] == "hello"

    def test_construct_with_timestamp(self):
        s = _make_sender()
        s.construct("ts", timestamp="2026-01-01T00:00:00.000")
        item = s.get_queue()[0]
        assert item["timestamp"] == "2026-01-01T00:00:00.000"

    def test_construct_with_time(self):
        s = _make_sender()
        s.construct("t", time=500)
        item = s.get_queue()[0]
        assert item["time"] == 500

    def test_get_queue_returns_copy(self):
        s = _make_sender()
        s.construct("a")
        q = s.get_queue()
        q.clear()
        assert len(s.get_queue()) == 1

    def test_clear_queue(self):
        s = _make_sender()
        s.construct("a")
        s.construct("b")
        count = s.clear_queue()
        assert count == 2
        assert s.get_queue() == []


# ---------------------------------------------------------------------------
# sync()
# ---------------------------------------------------------------------------

class TestSync:
    def _started_sender(self):
        s = _make_sender()
        s._token = "jwt"
        s._is_started = True
        return s

    def test_sync_posts_to_sync_endpoint(self):
        s = self._started_sender()
        resp_data = {"syncOffset": 50, "roundTripTime": 20, "serverTimestamp": "2026-01-01T00:00:00.000"}
        with patch("urllib.request.urlopen", return_value=_make_urlopen_response(resp_data)):
            result = s.sync()
        assert result["syncOffset"] == 50
        assert s._sync_offset == 50

    def test_sync_raises_network_error_on_failure(self):
        s = self._started_sender()
        with patch("urllib.request.urlopen", side_effect=_make_http_error(500)):
            with pytest.raises(NetworkError):
                s.sync()


# ---------------------------------------------------------------------------
# heartbeat()
# ---------------------------------------------------------------------------

class TestHeartbeat:
    def _started_sender(self):
        s = _make_sender()
        s._token = "jwt"
        s._is_started = True
        return s

    def test_heartbeat_gets_live_endpoint(self):
        s = self._started_sender()
        resp_data = {"sequence": 3, "syncOffset": 10}
        with patch("urllib.request.urlopen", return_value=_make_urlopen_response(resp_data)):
            result = s.heartbeat()
        assert result["sequence"] == 3
        assert s._sequence == 3
        assert s._sync_offset == 10

    def test_heartbeat_raises_network_error_on_failure(self):
        s = self._started_sender()
        with patch("urllib.request.urlopen", side_effect=_make_http_error(401)):
            with pytest.raises(NetworkError):
                s.heartbeat()


# ---------------------------------------------------------------------------
# get/set sequence and sync offset
# ---------------------------------------------------------------------------

class TestGettersSetters:
    def test_get_set_sequence(self):
        s = _make_sender()
        s.set_sequence(99)
        assert s.get_sequence() == 99

    def test_set_sequence_returns_self(self):
        s = _make_sender()
        assert s.set_sequence(1) is s

    def test_get_set_sync_offset(self):
        s = _make_sender()
        s.set_sync_offset(250)
        assert s.get_sync_offset() == 250

    def test_set_sync_offset_returns_self(self):
        s = _make_sender()
        assert s.set_sync_offset(0) is s

    def test_get_started_at(self):
        s = _make_sender()
        s._started_at = 1700000000.0
        assert s.get_started_at() == 1700000000.0


# ---------------------------------------------------------------------------
# _fetch() — HTTP error body parsing
# ---------------------------------------------------------------------------

class TestFetch:
    def test_network_error_includes_status_code(self):
        s = _make_sender()
        err = _make_http_error(403, {"error": "Forbidden"})
        with patch("urllib.request.urlopen", side_effect=err):
            with pytest.raises(NetworkError) as exc_info:
                s._fetch("/live")
        assert exc_info.value.status_code == 403

    def test_network_error_message_from_body(self):
        s = _make_sender()
        err = _make_http_error(401, {"error": "Invalid key"})
        with patch("urllib.request.urlopen", side_effect=err):
            with pytest.raises(NetworkError) as exc_info:
                s._fetch("/live")
        assert "Invalid key" in str(exc_info.value)

    def test_generic_exception_wrapped_in_network_error(self):
        s = _make_sender()
        with patch("urllib.request.urlopen", side_effect=OSError("timeout")):
            with pytest.raises(NetworkError):
                s._fetch("/live")

    def test_attaches_authorization_header_when_token_set(self):
        s = _make_sender()
        s._token = "my-jwt"
        captured_headers = []

        def capture(req):
            captured_headers.append(dict(req.headers))
            return _make_urlopen_response({"ok": True})

        with patch("urllib.request.urlopen", side_effect=capture):
            s._fetch("/live")

        # Headers are title-cased by urllib
        assert "Authorization" in captured_headers[0]
        assert "my-jwt" in captured_headers[0]["Authorization"]

    def test_no_auth_header_when_auth_false(self):
        s = _make_sender()
        s._token = "my-jwt"
        captured_headers = []

        def capture(req):
            captured_headers.append(dict(req.headers))
            return _make_urlopen_response({"token": "t", "sequence": 0, "syncOffset": 0, "startedAt": 0.0})

        with patch("urllib.request.urlopen", side_effect=capture):
            s._fetch("/live", method="POST", body={}, auth=False)

        assert "Authorization" not in captured_headers[0]
