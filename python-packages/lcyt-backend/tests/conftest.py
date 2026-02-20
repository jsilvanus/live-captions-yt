"""Shared pytest fixtures for lcyt-backend tests."""

import os
import sqlite3
import pytest

from lcyt_backend.app import create_app
from lcyt_backend.db import init_db


@pytest.fixture
def app(tmp_path):
    """Create a Flask test app with an in-memory-like temp database."""
    db_path = str(tmp_path / "test.db")
    os.environ["JWT_SECRET"] = "test-jwt-secret"
    os.environ["ADMIN_KEY"] = "test-admin-key"
    flask_app = create_app(db_path=db_path, testing=True)
    yield flask_app
    flask_app.config["STORE"].stop_cleanup()
    flask_app.config["DB"].close()


@pytest.fixture
def client(app):
    """Flask test client."""
    return app.test_client()


@pytest.fixture
def db(app):
    """Direct database connection from the app config."""
    return app.config["DB"]


@pytest.fixture
def store(app):
    """Session store from the app config."""
    return app.config["STORE"]


@pytest.fixture
def jwt_secret(app):
    """The JWT secret used by the app."""
    return app.config["JWT_SECRET"]


@pytest.fixture
def admin_headers():
    """Headers with a valid admin key."""
    return {"X-Admin-Key": "test-admin-key"}


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
