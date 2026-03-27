"""POST /sync — NTP-style clock sync for the session's sender (Bearer auth)."""

import time

from flask import Blueprint, current_app, g, jsonify

from ..middleware.auth import require_auth

sync_bp = Blueprint("sync", __name__)


@sync_bp.post("/")
@require_auth
def sync_session():
    """POST /sync — Trigger a clock sync for the current session."""
    senders = current_app.config["SENDERS"]
    session_id = g.session["sessionId"]
    entry = senders.get(session_id)

    if not entry:
        return jsonify({"error": "Session not found"}), 404

    try:
        sender = entry["sender"]
        t0 = time.monotonic()
        result = sender.heartbeat()
        t1 = time.monotonic()

        rtt_ms = int((t1 - t0) * 1000)
        sync_offset = rtt_ms // 2

        entry["sync_offset"] = sync_offset

        return jsonify({
            "syncOffset": sync_offset,
            "roundTripTime": rtt_ms,
            "serverTimestamp": result.server_timestamp,
            "statusCode": result.status_code,
        }), 200

    except Exception as exc:
        return jsonify({
            "error": str(exc) or "Sync failed: YouTube server did not respond",
            "statusCode": 502,
        }), 502
