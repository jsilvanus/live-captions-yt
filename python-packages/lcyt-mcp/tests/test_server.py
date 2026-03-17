"""Smoke tests for lcyt_mcp.server — start → send → stop lifecycle.

Uses create_handlers(FakeSender) so no network calls or lcyt install is needed.
"""

import json
import pytest
from lcyt_mcp.server import create_handlers, TOOLS


# ---------------------------------------------------------------------------
# Fake sender — mirrors the public API of YoutubeLiveCaptionSender
# ---------------------------------------------------------------------------


class _FakeSendResult:
    def __init__(self, sequence=0, count=None):
        self.sequence = sequence
        self.status_code = 200
        self.response = "ok"
        self.server_timestamp = "2024-01-01T00:00:00.000"
        self.count = count
        self.timestamp = None


class FakeSender:
    """Stand-in for YoutubeLiveCaptionSender that never touches the network."""

    def __init__(self, *, stream_key=None, **kwargs):
        self._stream_key = stream_key
        self._sequence = 0
        self._sync_offset = 0
        self._started = False

    def start(self):
        self._started = True
        return self

    def send(self, text, timestamp=None):
        result = _FakeSendResult(sequence=self._sequence)
        self._sequence += 1
        return result

    def send_batch(self, captions):
        count = len(captions)
        result = _FakeSendResult(sequence=self._sequence, count=count)
        self._sequence += count
        return result

    def sync(self):
        return {
            "sync_offset": 42,
            "round_trip_time": 10,
            "server_timestamp": None,
            "status_code": 200,
        }

    def get_sequence(self):
        return self._sequence

    def get_sync_offset(self):
        return self._sync_offset

    def end(self):
        self._started = False
        return self


# ---------------------------------------------------------------------------
# Fixture — fresh handler set per test
# ---------------------------------------------------------------------------


@pytest.fixture()
def h():
    """Return a fresh create_handlers(FakeSender) dict for each test."""
    return create_handlers(FakeSender)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_tools_list_has_sixteen_entries():
    assert len(TOOLS) == 16
    names = {t.name for t in TOOLS}
    assert {"start", "send_caption", "send_batch", "sync_clock", "get_status", "stop"}.issubset(names)
    assert {"list_cameras", "camera_preset", "list_mixers", "switch_source"}.issubset(names)
    assert {
        "list_dsk_templates", "activate_dsk_template", "broadcast_dsk_data",
        "dsk_renderer_status", "start_dsk_renderer", "stop_dsk_renderer",
    }.issubset(names)


@pytest.mark.asyncio
async def test_list_tools_matches_tools_constant(h):
    result = await h["list_tools"]()
    assert result == TOOLS


@pytest.mark.asyncio
async def test_start_creates_session(h):
    result = await h["call_tool"]("start", {"stream_key": "test-key"})
    payload = json.loads(result[0].text)
    assert "session_id" in payload
    assert payload["session_id"] in h["sessions"]


@pytest.mark.asyncio
async def test_start_stores_metadata(h):
    result = await h["call_tool"]("start", {"stream_key": "test-key"})
    sid = json.loads(result[0].text)["session_id"]
    meta = h["session_meta"].get(sid)
    assert meta is not None
    assert "startedAt" in meta


@pytest.mark.asyncio
async def test_send_caption_returns_ok_and_sequence(h):
    start = await h["call_tool"]("start", {"stream_key": "k"})
    sid = json.loads(start[0].text)["session_id"]

    result = await h["call_tool"]("send_caption", {"session_id": sid, "text": "Hello!"})
    payload = json.loads(result[0].text)
    assert payload["ok"] is True
    assert "sequence" in payload


@pytest.mark.asyncio
async def test_send_batch_returns_ok_count(h):
    start = await h["call_tool"]("start", {"stream_key": "k"})
    sid = json.loads(start[0].text)["session_id"]

    captions = [{"text": "A"}, {"text": "B"}, {"text": "C"}]
    result = await h["call_tool"]("send_batch", {"session_id": sid, "captions": captions})
    payload = json.loads(result[0].text)
    assert payload["ok"] is True
    assert payload["count"] == 3


@pytest.mark.asyncio
async def test_sync_clock_returns_offset(h):
    start = await h["call_tool"]("start", {"stream_key": "k"})
    sid = json.loads(start[0].text)["session_id"]

    result = await h["call_tool"]("sync_clock", {"session_id": sid})
    payload = json.loads(result[0].text)
    assert "syncOffset" in payload
    assert payload["syncOffset"] == 42


@pytest.mark.asyncio
async def test_get_status_returns_sequence_and_offset(h):
    start = await h["call_tool"]("start", {"stream_key": "k"})
    sid = json.loads(start[0].text)["session_id"]

    result = await h["call_tool"]("get_status", {"session_id": sid})
    payload = json.loads(result[0].text)
    assert "sequence" in payload
    assert "syncOffset" in payload


@pytest.mark.asyncio
async def test_stop_removes_session(h):
    start = await h["call_tool"]("start", {"stream_key": "k"})
    sid = json.loads(start[0].text)["session_id"]

    result = await h["call_tool"]("stop", {"session_id": sid})
    assert json.loads(result[0].text)["ok"] is True
    assert sid not in h["sessions"]


@pytest.mark.asyncio
async def test_full_lifecycle(h):
    """start → send_caption → send_batch → get_status → stop."""
    start = await h["call_tool"]("start", {"stream_key": "my-stream"})
    sid = json.loads(start[0].text)["session_id"]
    assert sid in h["sessions"]

    await h["call_tool"]("send_caption", {"session_id": sid, "text": "Line one"})
    await h["call_tool"]("send_batch", {"session_id": sid, "captions": [{"text": "A"}, {"text": "B"}]})

    status = await h["call_tool"]("get_status", {"session_id": sid})
    assert json.loads(status[0].text)["sequence"] == 3  # 1 single + 2 batch

    stop = await h["call_tool"]("stop", {"session_id": sid})
    assert json.loads(stop[0].text)["ok"] is True
    assert sid not in h["sessions"]


@pytest.mark.asyncio
async def test_unknown_session_raises(h):
    with pytest.raises(ValueError, match="Unknown session_id"):
        await h["call_tool"]("send_caption", {"session_id": "bad-id", "text": "Hi"})


@pytest.mark.asyncio
async def test_unknown_tool_raises(h):
    with pytest.raises(ValueError, match="Unknown tool"):
        await h["call_tool"]("not_a_tool", {})


@pytest.mark.asyncio
async def test_list_resources_reflects_sessions(h):
    before = await h["list_resources"]()
    assert before == []

    start = await h["call_tool"]("start", {"stream_key": "k"})
    sid = json.loads(start[0].text)["session_id"]

    after = await h["list_resources"]()
    uris = [str(r.uri) for r in after]
    assert f"session://{sid}" in uris


@pytest.mark.asyncio
async def test_read_resource_returns_snapshot(h):
    start = await h["call_tool"]("start", {"stream_key": "k"})
    sid = json.loads(start[0].text)["session_id"]

    text = await h["read_resource"](f"session://{sid}")
    payload = json.loads(text)
    assert "sequence" in payload
    assert "syncOffset" in payload
    assert "startedAt" in payload


@pytest.mark.asyncio
async def test_read_resource_unknown_uri_raises(h):
    with pytest.raises(ValueError, match="Unknown resource URI"):
        await h["read_resource"]("unknown://foo")


# ---------------------------------------------------------------------------
# Production and DSK tools — no LCYT_BACKEND_URL configured
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_list_cameras_returns_error_without_backend_url(h, monkeypatch):
    monkeypatch.setattr("lcyt_mcp.server.BACKEND_URL", "")
    result = await h["call_tool"]("list_cameras", {})
    payload = json.loads(result[0].text)
    assert "error" in payload
    assert "LCYT_BACKEND_URL" in payload["error"]


@pytest.mark.asyncio
async def test_camera_preset_returns_error_without_backend_url(h, monkeypatch):
    monkeypatch.setattr("lcyt_mcp.server.BACKEND_URL", "")
    result = await h["call_tool"]("camera_preset", {"camera_id": "1", "preset_id": "2"})
    payload = json.loads(result[0].text)
    assert "error" in payload
    assert "LCYT_BACKEND_URL" in payload["error"]


@pytest.mark.asyncio
async def test_list_mixers_returns_error_without_backend_url(h, monkeypatch):
    monkeypatch.setattr("lcyt_mcp.server.BACKEND_URL", "")
    result = await h["call_tool"]("list_mixers", {})
    payload = json.loads(result[0].text)
    assert "error" in payload
    assert "LCYT_BACKEND_URL" in payload["error"]


@pytest.mark.asyncio
async def test_switch_source_returns_error_without_backend_url(h, monkeypatch):
    monkeypatch.setattr("lcyt_mcp.server.BACKEND_URL", "")
    result = await h["call_tool"]("switch_source", {"mixer_id": "1", "input": 2})
    payload = json.loads(result[0].text)
    assert "error" in payload
    assert "LCYT_BACKEND_URL" in payload["error"]


@pytest.mark.asyncio
async def test_list_dsk_templates_returns_error_without_backend_url(h, monkeypatch):
    monkeypatch.setattr("lcyt_mcp.server.BACKEND_URL", "")
    result = await h["call_tool"]("list_dsk_templates", {})
    payload = json.loads(result[0].text)
    assert "error" in payload
    assert "LCYT_BACKEND_URL" in payload["error"]


@pytest.mark.asyncio
async def test_activate_dsk_template_returns_error_without_backend_url(h, monkeypatch):
    monkeypatch.setattr("lcyt_mcp.server.BACKEND_URL", "")
    result = await h["call_tool"]("activate_dsk_template", {"template_id": 1})
    payload = json.loads(result[0].text)
    assert "error" in payload
    assert "LCYT_BACKEND_URL" in payload["error"]


@pytest.mark.asyncio
async def test_broadcast_dsk_data_returns_error_without_backend_url(h, monkeypatch):
    monkeypatch.setattr("lcyt_mcp.server.BACKEND_URL", "")
    result = await h["call_tool"]("broadcast_dsk_data", {"updates": [{"selector": ".x", "text": "hi"}]})
    payload = json.loads(result[0].text)
    assert "error" in payload
    assert "LCYT_BACKEND_URL" in payload["error"]


@pytest.mark.asyncio
async def test_dsk_renderer_status_returns_error_without_backend_url(h, monkeypatch):
    monkeypatch.setattr("lcyt_mcp.server.BACKEND_URL", "")
    result = await h["call_tool"]("dsk_renderer_status", {})
    payload = json.loads(result[0].text)
    assert "error" in payload
    assert "LCYT_BACKEND_URL" in payload["error"]


@pytest.mark.asyncio
async def test_start_dsk_renderer_returns_error_without_backend_url(h, monkeypatch):
    monkeypatch.setattr("lcyt_mcp.server.BACKEND_URL", "")
    result = await h["call_tool"]("start_dsk_renderer", {})
    payload = json.loads(result[0].text)
    assert "error" in payload
    assert "LCYT_BACKEND_URL" in payload["error"]


@pytest.mark.asyncio
async def test_stop_dsk_renderer_returns_error_without_backend_url(h, monkeypatch):
    monkeypatch.setattr("lcyt_mcp.server.BACKEND_URL", "")
    result = await h["call_tool"]("stop_dsk_renderer", {})
    payload = json.loads(result[0].text)
    assert "error" in payload
    assert "LCYT_BACKEND_URL" in payload["error"]
