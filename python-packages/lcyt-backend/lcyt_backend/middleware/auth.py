"""JWT authentication middleware for lcyt-backend (minimal relay)."""

import functools

from .._jwt import decode as jwt_decode, PyJWTError
from flask import current_app, g, jsonify, request


def require_auth(f):
    """Decorator that enforces JWT Bearer authentication.

    On success, sets ``g.session`` to the decoded JWT payload.
    On failure, returns 401 JSON.
    """
    @functools.wraps(f)
    def wrapper(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")

        if not auth_header.startswith("Bearer "):
            return jsonify({"error": "Authorization header required"}), 401

        token = auth_header[len("Bearer "):]
        secret = current_app.config["JWT_SECRET"]

        try:
            payload = jwt_decode(token, secret)
        except PyJWTError as exc:
            return jsonify({"error": f"Invalid token: {exc}"}), 401

        g.session = payload
        return f(*args, **kwargs)

    return wrapper
