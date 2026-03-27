"""POST/GET/DELETE /live — session registration (no API key validation).

This is a minimal relay backend. Any client with a valid stream key can
register a session — there is no API key database or admin management.
"""

import hashlib
import logging
import os
import time

from flask import Blueprint, current_app, g, jsonify, request
from .._jwt import encode as jwt_encode
from ..middleware.auth import require_auth
from .._compat import import_sender

live_bp = Blueprint("live", __name__)
_log = logging.getLogger(__name__)


def _make_session_id(api_key: str, stream_key: str, domain: str) -> str:
    raw = f"{api_key}:{stream_key}:{domain}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _sync_sender(sender) -> dict:
    t0 = time.monotonic()
    result = sender.heartbeat()
    t1 = time.monotonic()
    rtt_ms = int((t1 - t0) * 1000)
    return {
        "sync_offset": rtt_ms // 2,
        "round_trip_time": rtt_ms,
        "server_timestamp": result.server_timestamp,
        "status_code": result.status_code,
    }


@live_bp.post("/")
def register_session():
    """POST /live — Register a new caption session.

    No API key validation — any key is accepted. The stream key
    (either top-level or inside a targets array) determines which
    YouTube ingestion URL is used.
    """
    senders = current_app.config["SENDERS"]
    jwt_secret = current_app.config["JWT_SECRET"]

    body = request.get_json(silent=True) or {}
    api_key = body.get("apiKey", "relay")
    stream_key = body.get("streamKey", "")
    domain = body.get("domain", request.host)

    # Extract stream key from targets array if not given top-level
    targets = body.get("targets", [])
    if not stream_key and targets:
        for t in targets:
            if t.get("type") == "youtube" and t.get("streamKey"):
                stream_key = t["streamKey"]
                break

    if not stream_key:
        return jsonify({"error": "streamKey is required (top-level or in targets)"}), 400

    session_id = _make_session_id(api_key, stream_key, domain)

    # Idempotent: return existing session
    if session_id in senders:
        existing = senders[session_id]
        return jsonify({
            "token": existing["jwt"],
            "sessionId": session_id,
            "sequence": existing["sender"].get_sequence(),
            "syncOffset": existing.get("sync_offset", 0),
            "startedAt": existing["started_at"],
        }), 200

    # Create sender
    YoutubeLiveCaptionSender = import_sender()
    start_seq = int(body.get("sequence", 0))
    sender = YoutubeLiveCaptionSender(stream_key=stream_key, sequence=start_seq)
    sender.start()

    # Initial sync — best-effort
    sync_offset = 0
    try:
        sync_result = _sync_sender(sender)
        sync_offset = sync_result["sync_offset"]
    except Exception:
        _log.warning("Initial clock sync failed", exc_info=True)

    # Sign JWT
    payload = {
        "sessionId": session_id,
        "apiKey": api_key,
        "exp": int(time.time()) + 7200,
    }
    token = jwt_encode(payload, jwt_secret)

    started_at = time.time()
    senders[session_id] = {
        "sender": sender,
        "jwt": token,
        "api_key": api_key,
        "stream_key": stream_key,
        "sync_offset": sync_offset,
        "started_at": started_at,
    }

    return jsonify({
        "token": token,
        "sessionId": session_id,
        "sequence": sender.get_sequence(),
        "syncOffset": sync_offset,
        "startedAt": started_at,
    }), 200


@live_bp.get("/")
@require_auth
def session_status():
    """GET /live — Get current session status."""
    senders = current_app.config["SENDERS"]
    session_id = g.session["sessionId"]
    entry = senders.get(session_id)
    if not entry:
        return jsonify({"error": "Session not found"}), 404

    return jsonify({
        "sequence": entry["sender"].get_sequence(),
        "syncOffset": entry.get("sync_offset", 0),
    }), 200


@live_bp.delete("/")
@require_auth
def remove_session():
    """DELETE /live — Tear down session."""
    senders = current_app.config["SENDERS"]
    session_id = g.session["sessionId"]
    entry = senders.pop(session_id, None)
    if not entry:
        return jsonify({"error": "Session not found"}), 404

    try:
        entry["sender"].end()
    except Exception:
        _log.warning("Sender cleanup failed", exc_info=True)

    return jsonify({"removed": True, "sessionId": session_id}), 200
