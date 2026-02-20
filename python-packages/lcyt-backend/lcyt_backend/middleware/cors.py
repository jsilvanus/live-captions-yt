"""Dynamic CORS middleware for lcyt-backend."""

from flask import Flask, request

from ..store import SessionStore

_ALLOWED_HEADERS = "Content-Type, Authorization, X-Admin-Key"
_ALLOWED_METHODS = "GET, POST, DELETE, PATCH, OPTIONS"


def register_cors_middleware(app: Flask, store: SessionStore) -> None:
    """Attach dynamic CORS logic to the Flask app via after_request hooks.

    Rules (mirrors the Node.js backend):
      - /keys routes          — no CORS headers (server-side admin only)
      - POST /live, GET /health, OPTIONS — permissive (any origin)
      - All other routes      — dynamic: allow origin only if it has an active session

    Args:
        app: Flask application instance.
        store: Active session store used to look up registered origins.
    """

    @app.before_request
    def handle_preflight():
        """Short-circuit OPTIONS preflight requests."""
        if request.method != "OPTIONS":
            return None

        origin = request.headers.get("Origin", "")
        path = request.path

        # Admin endpoints — no CORS even for OPTIONS
        if path.startswith("/keys"):
            return ("", 204)

        if origin:
            response_headers = {
                "Access-Control-Allow-Methods": _ALLOWED_METHODS,
                "Access-Control-Allow-Headers": _ALLOWED_HEADERS,
                "Access-Control-Allow-Credentials": "true",
            }

            # Permissive routes or a registered origin
            if _is_permissive_route(request.method, path) or store.get_by_domain(origin):
                response_headers["Access-Control-Allow-Origin"] = origin

            return ("", 204, response_headers)

        return ("", 204)

    @app.after_request
    def add_cors_headers(response):
        """Add CORS headers to non-preflight responses."""
        origin = request.headers.get("Origin", "")
        path = request.path
        method = request.method

        # Admin endpoints — no CORS headers
        if path.startswith("/keys"):
            return response

        if not origin:
            return response

        if _is_permissive_route(method, path):
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Methods"] = _ALLOWED_METHODS
            response.headers["Access-Control-Allow-Headers"] = _ALLOWED_HEADERS
            response.headers["Access-Control-Allow-Credentials"] = "true"
        elif store.get_by_domain(origin):
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Methods"] = _ALLOWED_METHODS
            response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
            response.headers["Access-Control-Allow-Credentials"] = "true"
        # else: no match → omit CORS headers (browser will block the request)

        return response


def _is_permissive_route(method: str, path: str) -> bool:
    return (method == "POST" and path == "/live") or (method == "GET" and path == "/health")
