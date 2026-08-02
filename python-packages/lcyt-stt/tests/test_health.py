from fastapi.testclient import TestClient

from lcyt_stt.serve.app import create_app


class _NotLoadedHost:
    model_id = "stub-model"
    device = None
    compute_type = None
    loaded = False

    def load(self):
        pass


class _LoadedHost(_NotLoadedHost):
    device = "cpu"
    compute_type = "int8"
    loaded = True


def test_health_returns_503_before_model_loaded():
    app = create_app(model_host=_NotLoadedHost())
    with TestClient(app) as client:
        resp = client.get("/health")
    assert resp.status_code == 503
    body = resp.json()
    assert body["loaded"] is False
    assert body["status"] == "loading"


def test_health_returns_200_once_loaded():
    app = create_app(model_host=_LoadedHost())
    with TestClient(app) as client:
        resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body == {
        "status": "ok",
        "model_id": "stub-model",
        "device": "cpu",
        "compute_type": "int8",
        "loaded": True,
    }
