import json

import httpx
import pytest

from lcyt_stt.dataset.client import CrowdSourceVoiceClient
from lcyt_stt.dataset.pull import UnsupportedCorpusTypeError, pull_snapshot

EXPORT_URL = "https://csv.example.org/api/export"
MANIFEST_URL = "https://csv.example.org/api/export/manifest"


def _export_payload(corpus_type="text", rows=None):
    rows = rows if rows is not None else [
        {"file": "0001.wav", "text": "moi maailma", "duration": 2.0, "quality_score": 4.5, "validation_count": 2, "speaker_id": "spkhash1"},
        {"file": "0002.wav", "text": "hyvää huomenta", "duration": 3.5, "quality_score": 4.2, "validation_count": 2, "speaker_id": "spkhash2"},
    ]
    return {
        "corpus": {"id": 3, "name": "Sunday sermons", "language": "fi", "type": corpus_type},
        "total_recordings": len(rows),
        "recordings": rows,
    }


def _manifest_payload(files=None):
    files = files if files is not None else [
        {"id": 1, "source_path": "uploads/audio/a.wav", "export_name": "0001.wav", "text": "moi maailma", "speaker_id": "spkhash1"},
        {"id": 2, "source_path": "uploads/audio/b.wav", "export_name": "0002.wav", "text": "hyvää huomenta", "speaker_id": "spkhash2"},
    ]
    return {"total": len(files), "files": files}


def _make_client(handler):
    transport = httpx.MockTransport(handler)
    return CrowdSourceVoiceClient("https://csv.example.org", "test-token", transport=transport)


def test_pull_snapshot_happy_path(tmp_path):
    export = _export_payload()
    manifest = _manifest_payload()

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/export":
            return httpx.Response(200, json=export)
        if request.url.path == "/api/export/manifest":
            return httpx.Response(200, json=manifest)
        if request.url.path.startswith("/uploads/audio/"):
            return httpx.Response(200, content=b"fake-audio-bytes")
        raise AssertionError(f"unexpected request: {request.url}")

    client = _make_client(handler)
    snapshot = pull_snapshot(base_url="https://csv.example.org", corpus_id=3, out_dir=tmp_path, client=client)

    assert snapshot["recording_count"] == 2
    assert snapshot["corpus_name"] == "Sunday sermons"
    assert snapshot["has_speaker_id"] is True
    assert snapshot["total_duration_seconds"] == pytest.approx(5.5)

    recordings = json.loads((tmp_path / "recordings.json").read_text())
    assert {r["file"] for r in recordings} == {"0001.wav", "0002.wav"}
    assert (tmp_path / "audio" / "0001.wav").read_bytes() == b"fake-audio-bytes"

    on_disk_snapshot = json.loads((tmp_path / "snapshot.json").read_text())
    assert on_disk_snapshot == snapshot


def test_pull_snapshot_rejects_music_corpus(tmp_path):
    export = _export_payload(corpus_type="music")

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/export":
            return httpx.Response(200, json=export)
        raise AssertionError(f"unexpected request: {request.url}")

    client = _make_client(handler)
    with pytest.raises(UnsupportedCorpusTypeError):
        pull_snapshot(base_url="https://csv.example.org", corpus_id=3, out_dir=tmp_path, client=client)


def test_pull_snapshot_skips_rows_outside_duration_gate(tmp_path):
    rows = [
        {"file": "0001.wav", "text": "ok", "duration": 2.0, "quality_score": 4.5, "validation_count": 2, "speaker_id": "spk1"},
        {"file": "0002.wav", "text": "too long", "duration": 45.0, "quality_score": 4.5, "validation_count": 2, "speaker_id": "spk2"},
        {"file": "0003.wav", "text": "too short", "duration": 0.1, "quality_score": 4.5, "validation_count": 2, "speaker_id": "spk3"},
    ]
    export = _export_payload(rows=rows)
    manifest = _manifest_payload(files=[
        {"id": 1, "source_path": "uploads/audio/a.wav", "export_name": "0001.wav", "text": "ok", "speaker_id": "spk1"},
        {"id": 2, "source_path": "uploads/audio/b.wav", "export_name": "0002.wav", "text": "too long", "speaker_id": "spk2"},
        {"id": 3, "source_path": "uploads/audio/c.wav", "export_name": "0003.wav", "text": "too short", "speaker_id": "spk3"},
    ])

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/export":
            return httpx.Response(200, json=export)
        if request.url.path == "/api/export/manifest":
            return httpx.Response(200, json=manifest)
        if request.url.path.startswith("/uploads/audio/"):
            return httpx.Response(200, content=b"fake-audio-bytes")
        raise AssertionError(f"unexpected request: {request.url}")

    client = _make_client(handler)
    snapshot = pull_snapshot(base_url="https://csv.example.org", corpus_id=3, out_dir=tmp_path, client=client)

    assert snapshot["recording_count"] == 1
    recordings = json.loads((tmp_path / "recordings.json").read_text())
    assert [r["file"] for r in recordings] == ["0001.wav"]


def test_pull_snapshot_missing_speaker_id_is_recorded(tmp_path):
    rows = [
        {"file": "0001.wav", "text": "ok", "duration": 2.0, "quality_score": 4.5, "validation_count": 2},
    ]
    export = _export_payload(rows=rows)
    manifest = _manifest_payload(files=[
        {"id": 1, "source_path": "uploads/audio/a.wav", "export_name": "0001.wav", "text": "ok"},
    ])

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/export":
            return httpx.Response(200, json=export)
        if request.url.path == "/api/export/manifest":
            return httpx.Response(200, json=manifest)
        if request.url.path.startswith("/uploads/audio/"):
            return httpx.Response(200, content=b"fake-audio-bytes")
        raise AssertionError(f"unexpected request: {request.url}")

    client = _make_client(handler)
    snapshot = pull_snapshot(base_url="https://csv.example.org", corpus_id=3, out_dir=tmp_path, client=client)

    assert snapshot["has_speaker_id"] is False
