"""JWT authentication middleware for lcyt-backend."""

import functools

from .._jwt import decode as jwt_decode, PyJWTError
from flask import current_app, g, jsonify, request


def require_auth(f):
    """Decorator that enforces JWT Bearer authentication.

    On success, sets ``g.session`` to the decoded JWT payload::

        {
            "sessionId": str,
            "apiKey":    str,
            "streamKey": str,
            "domain":    str,
        }

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
            g.session = payload
        except PyJWTError:
            return jsonify({"error": "Invalid or expired token"}), 401

        return f(*args, **kwargs)

    return wrapper
