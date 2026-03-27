"""Shared pytest fixtures for lcyt-backend tests."""

import os
import pytest

from lcyt_backend.app import create_app


@pytest.fixture
def app():
    """Create a Flask test app."""
    flask_app = create_app(testing=True)
    yield flask_app


@pytest.fixture
def client(app):
    """Flask test client."""
    return app.test_client()


@pytest.fixture
def jwt_secret(app):
    """The JWT secret used by the app."""
    return app.config["JWT_SECRET"]


@pytest.fixture
def mock_sender():
    """A mock YoutubeLiveCaptionSender for use in tests."""

    class MockSendResult:
        def __init__(self, status_code=200, server_timestamp="2024-01-01T00:00:00.000"):
            self.sequence = 0
            self.status_code = status_code
            self.response = server_timestamp or ""
            self.server_timestamp = server_timestamp
            self.count = None
            self.timestamp = None

    class MockSender:
        def __init__(self, stream_key=None, sequence=0, **kwargs):
            self._sequence = sequence
            self._started = False

        def start(self):
            self._started = True
            return self

        def end(self):
            self._started = False
            return self

        def get_sequence(self):
            return self._sequence

        def set_sequence(self, seq):
            self._sequence = seq
            return self

        def heartbeat(self):
            return MockSendResult()

        def send(self, text, timestamp=None):
            result = MockSendResult()
            result.sequence = self._sequence
            self._sequence += 1
            return result

        def send_batch(self, captions):
            result = MockSendResult()
            result.sequence = self._sequence
            result.count = len(captions)
            self._sequence += 1
            return result

    return MockSender


@pytest.fixture
def session_token(client, mock_sender, monkeypatch):
    """Register a session and return the JWT token."""
    monkeypatch.setattr(
        "lcyt_backend.routes.live.import_sender", lambda: mock_sender
    )
    resp = client.post("/live/", json={
        "apiKey": "test-key",
        "streamKey": "test-stream-key",
        "domain": "localhost",
    })
    assert resp.status_code == 200
    return resp.get_json()["token"]
