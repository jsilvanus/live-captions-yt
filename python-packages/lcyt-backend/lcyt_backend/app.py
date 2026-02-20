"""Flask application factory for lcyt-backend."""

import logging
import math
import os
import secrets

from flask import Flask, jsonify

from .db import init_db
from .store import SessionStore
from .middleware.cors import register_cors_middleware
from .routes.live import live_bp
from .routes.captions import captions_bp
from .routes.sync import sync_bp
from .routes.keys import keys_bp

logger = logging.getLogger(__name__)


def create_app(db_path: str | None = None, testing: bool = False) -> Flask:
    """Flask application factory.

    Environment variables:
        JWT_SECRET   — HS256 secret for signing session JWTs.
                       If unset a random secret is used (tokens won't survive restart).
        ADMIN_KEY    — Secret for X-Admin-Key header on /keys routes.
                       If unset the /keys admin API returns 503.
        DB_PATH      — Path to the SQLite database file.
        SESSION_TTL  — Session idle timeout in seconds (default 7200).
        PORT         — Port for the dev server (used by __main__ only).

    Args:
        db_path: Override the SQLite database path (useful in tests).
        testing: Set Flask testing mode (disables error catching).

    Returns:
        Configured Flask application.
    """
    app = Flask(__name__)
    app.config["TESTING"] = testing

    # -------------------------------------------------------------------------
    # JWT secret
    # -------------------------------------------------------------------------
    jwt_secret = os.environ.get("JWT_SECRET")
    if not jwt_secret:
        jwt_secret = secrets.token_hex(32)
        logger.warning(
            "JWT_SECRET is not set — using a random secret. "
            "Tokens will not survive restarts. "
            "Set JWT_SECRET in your environment for production use."
        )
    app.config["JWT_SECRET"] = jwt_secret

    # -------------------------------------------------------------------------
    # Admin key notice
    # -------------------------------------------------------------------------
    if not os.environ.get("ADMIN_KEY"):
        logger.info(
            "ADMIN_KEY is not set — /keys admin endpoints are disabled. "
            "Set ADMIN_KEY in your environment to enable API key management via HTTP."
        )

    # -------------------------------------------------------------------------
    # Database and session store
    # -------------------------------------------------------------------------
    db = init_db(db_path)
    store = SessionStore()
    app.config["DB"] = db
    app.config["STORE"] = store

    # -------------------------------------------------------------------------
    # CORS (dynamic, session-aware)
    # -------------------------------------------------------------------------
    register_cors_middleware(app, store)

    # -------------------------------------------------------------------------
    # JSON body limit (64 KB) — Flask enforces via MAX_CONTENT_LENGTH
    # -------------------------------------------------------------------------
    app.config["MAX_CONTENT_LENGTH"] = 64 * 1024

    # -------------------------------------------------------------------------
    # Request logging
    # -------------------------------------------------------------------------
    @app.after_request
    def log_request(response):
        from flask import request
        logger.info("%s %s %d", request.method, request.path, response.status_code)
        return response

    # -------------------------------------------------------------------------
    # Health check — no auth required
    # -------------------------------------------------------------------------
    @app.get("/health")
    def health():
        import time
        return jsonify({
            "ok": True,
            "uptime": math.floor(time.process_time()),
            "activeSessions": store.size(),
        })

    # -------------------------------------------------------------------------
    # Blueprints
    # -------------------------------------------------------------------------
    app.register_blueprint(live_bp, url_prefix="/live")
    app.register_blueprint(captions_bp, url_prefix="/captions")
    app.register_blueprint(sync_bp, url_prefix="/sync")
    app.register_blueprint(keys_bp, url_prefix="/keys")

    return app
