"""Flask application factory for lcyt-backend.

This is a minimal CORS relay for YouTube caption sending.
No API key database or admin management required.
Any client with a valid YouTube stream key can register a session
via POST /live and send captions via POST /captions.
"""

import logging
import math
import os
import secrets
import time

from flask import Flask, jsonify

from .routes.live import live_bp
from .routes.captions import captions_bp
from .routes.sync import sync_bp

logger = logging.getLogger(__name__)

# Features this backend supports — returned in GET /health so that
# lcyt-web (or any client) can adapt its UI to the available capabilities.
FEATURES = ["captions", "sync"]


def create_app(testing: bool = False) -> Flask:
    """Flask application factory.

    Creates a minimal CORS relay for YouTube caption ingestion.
    No API key database — any client with a stream key can connect.

    Environment variables:
        PORT — Port for the dev server (used by run.py only).

    Args:
        testing: Set Flask testing mode (disables error catching).

    Returns:
        Configured Flask application.
    """
    app = Flask(__name__)
    app.config["TESTING"] = testing

    # -------------------------------------------------------------------------
    # JWT secret — use env var in production, auto-generate for dev/testing.
    # When auto-generated, tokens are invalidated on restart.
    # -------------------------------------------------------------------------
    env_secret = os.environ.get("JWT_SECRET")
    if env_secret:
        app.config["JWT_SECRET"] = env_secret
    else:
        app.config["JWT_SECRET"] = secrets.token_hex(32)
        if not testing:
            logger.warning(
                "JWT_SECRET not set — using auto-generated secret. "
                "Sessions will be lost on restart. Set JWT_SECRET env var for production."
            )

    # -------------------------------------------------------------------------
    # Sender cache — keyed by session ID
    # -------------------------------------------------------------------------
    app.config["SENDERS"] = {}

    # -------------------------------------------------------------------------
    # Permissive CORS — allow all origins (unauthenticated relay)
    # -------------------------------------------------------------------------
    @app.after_request
    def add_cors_headers(response):
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        return response

    @app.before_request
    def handle_preflight():
        from flask import request
        if request.method == "OPTIONS":
            return ("", 204, {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, Authorization",
            })

    # -------------------------------------------------------------------------
    # JSON body limit (64 KB)
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
    # Startup time — for uptime calculation in /health
    # -------------------------------------------------------------------------
    app.config["START_TIME"] = time.monotonic()

    # -------------------------------------------------------------------------
    # Health check — includes features list for client capability detection
    # -------------------------------------------------------------------------
    @app.get("/health")
    def health():
        senders = app.config["SENDERS"]
        return jsonify({
            "ok": True,
            "uptime": math.floor(time.monotonic() - app.config["START_TIME"]),
            "activeSessions": len(senders),
            "features": FEATURES,
        })

    # -------------------------------------------------------------------------
    # Blueprints
    # -------------------------------------------------------------------------
    app.register_blueprint(live_bp, url_prefix="/live")
    app.register_blueprint(captions_bp, url_prefix="/captions")
    app.register_blueprint(sync_bp, url_prefix="/sync")

    return app
