"""Admin key authentication middleware for lcyt-backend."""

import functools
import hmac
import os

from flask import jsonify, request


def require_admin(f):
    """Decorator that enforces X-Admin-Key header authentication.

    Protects /keys routes. All requests must include the correct
    X-Admin-Key header that matches the ADMIN_KEY environment variable.

    Behavior:
        - ADMIN_KEY not set  → 503 (admin API not configured)
        - Header missing     → 401
        - Key mismatch       → 403 (constant-time comparison)
        - Key matches        → proceeds to view function
    """
    @functools.wraps(f)
    def wrapper(*args, **kwargs):
        admin_key = os.environ.get("ADMIN_KEY")

        if not admin_key:
            return jsonify({"error": "Admin API not configured"}), 503

        provided_key = request.headers.get("X-Admin-Key", "")

        if not provided_key:
            return jsonify({"error": "X-Admin-Key header required"}), 401

        # Constant-time comparison to prevent timing attacks
        if not hmac.compare_digest(admin_key.encode(), provided_key.encode()):
            return jsonify({"error": "Invalid admin key"}), 403

        return f(*args, **kwargs)

    return wrapper
