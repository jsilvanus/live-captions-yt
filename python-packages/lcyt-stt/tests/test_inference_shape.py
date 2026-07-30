from fastapi.testclient import TestClient

from lcyt_stt.serve.app import create_app
from lcyt_stt.serve.queue import InferenceQueue


class _StubModelHost:
    model_id = "stub-model"
    device = "cpu"
    compute_type = "int8"
    loaded = True

    def __init__(self):
        self.calls = []

    def load(self):
        pass

    def transcribe(self, audio_path, language=None):
        self.calls.append({"audio_path": audio_path, "language": language})
        return {"text": "moi maailma", "language": language, "segments": []}


def _client():
    host = _StubModelHost()
    app = create_app(model_host=host, queue=InferenceQueue(max_queue=8))
    return app, host


def test_inference_returns_whisper_cpp_compatible_shape():
    app, host = _client()
    with TestClient(app) as client:
        resp = client.post(
            "/inference",
            files={"file": ("clip.wav", b"not-real-wav-bytes", "audio/wav")},
            data={"language": "en"},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["text"] == "moi maailma"
    assert body["language"] == "en"
    assert body["segments"] == []
    assert host.calls[0]["language"] == "en"


def test_inference_defaults_language_to_fi():
    app, host = _client()
    with TestClient(app) as client:
        resp = client.post(
            "/inference",
            files={"file": ("clip.mp4", b"not-real-mp4-bytes", "audio/mp4")},
        )
    assert resp.status_code == 200
    assert resp.json()["language"] == "fi"
    assert host.calls[0]["language"] == "fi"


def test_inference_returns_503_when_model_not_loaded():
    class _NotLoaded(_StubModelHost):
        loaded = False

    app = create_app(model_host=_NotLoaded(), queue=InferenceQueue(max_queue=8))
    with TestClient(app) as client:
        resp = client.post("/inference", files={"file": ("clip.wav", b"x", "audio/wav")})
    assert resp.status_code == 503
