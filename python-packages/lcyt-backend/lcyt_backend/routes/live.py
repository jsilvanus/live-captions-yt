"""POST/GET/DELETE /live — session registration and management."""

import time

from flask import Blueprint, current_app, g, jsonify, request
from .._jwt import encode as jwt_encode

from ..db import validate_api_key
from ..middleware.auth import require_auth
from ..store import make_session_id
from .._compat import import_sender

live_bp = Blueprint("live", __name__)


def _sync_sender(sender) -> dict:
    """Perform an NTP-style sync using a heartbeat round-trip.

    Returns:
        dict with sync_offset (ms), round_trip_time (ms), server_timestamp, status_code.
    """
    t0 = time.monotonic()
    result = sender.heartbeat()
    t1 = time.monotonic()
    rtt_ms = int((t1 - t0) * 1000)
    sync_offset = rtt_ms // 2
    return {
        "sync_offset": sync_offset,
        "round_trip_time": rtt_ms,
        "server_timestamp": result.server_timestamp,
        "status_code": result.status_code,
    }


@live_bp.post("/")
def register_session():
    """POST /live — Register a new session (idempotent)."""
    db = current_app.config["DB"]
    store = current_app.config["STORE"]
    jwt_secret = current_app.config["JWT_SECRET"]

    body = request.get_json(silent=True) or {}
    api_key = body.get("apiKey")
    stream_key = body.get("streamKey")
    domain = body.get("domain")
    start_seq = int(body.get("sequence", 0))

    if not api_key or not stream_key or not domain:
        return jsonify({"error": "apiKey, streamKey, and domain are required"}), 400

    # Validate API key
    validation = validate_api_key(db, api_key)
    if not validation["valid"]:
        return jsonify({"error": f"API key {validation['reason']}"}), 401

    # Deterministic session ID
    session_id = make_session_id(api_key, stream_key, domain)

    # Idempotent: return existing session if present
    if store.has(session_id):
        existing = store.get(session_id)
        store.touch(session_id)
        response = jsonify({
            "token": existing["jwt"],
            "sessionId": session_id,
            "sequence": existing["sequence"],
            "syncOffset": existing["sync_offset"],
            "startedAt": existing["started_at"],
        })
        response.headers["Access-Control-Allow-Origin"] = domain
        return response, 200

    # Create sender and start it
    YoutubeLiveCaptionSender = import_sender()
    sender = YoutubeLiveCaptionSender(stream_key=stream_key, sequence=start_seq)
    sender.start()

    # Initial sync — best-effort
    sync_offset = 0
    try:
        sync_result = _sync_sender(sender)
        sync_offset = sync_result["sync_offset"]
    except Exception:
        pass  # not fatal

    # Sign JWT
    payload = {
        "sessionId": session_id,
        "apiKey": api_key,
        "streamKey": stream_key,
        "domain": domain,
    }
    token = jwt_encode(payload, jwt_secret)

    # Store session
    session = store.create(
        api_key=api_key,
        stream_key=stream_key,
        domain=domain,
        jwt=token,
        sequence=sender.get_sequence(),
        sync_offset=sync_offset,
        sender=sender,
    )

    response = jsonify({
        "token": token,
        "sessionId": session_id,
        "sequence": session["sequence"],
        "syncOffset": session["sync_offset"],
        "startedAt": session["started_at"],
    })
    response.headers["Access-Control-Allow-Origin"] = domain
    return response, 200


@live_bp.get("/")
@require_auth
def session_status():
    """GET /live — Get current session status."""
    store = current_app.config["STORE"]
    session_id = g.session["sessionId"]
    session = store.get(session_id)

    if not session:
        return jsonify({"error": "Session not found"}), 404

    store.touch(session_id)
    return jsonify({
        "sequence": session["sequence"],
        "syncOffset": session["sync_offset"],
    }), 200


@live_bp.delete("/")
@require_auth
def remove_session():
    """DELETE /live — Tear down session."""
    store = current_app.config["STORE"]
    session_id = g.session["sessionId"]
    session = store.get(session_id)

    if not session:
        return jsonify({"error": "Session not found"}), 404

    try:
        session["sender"].end()
    except Exception:
        pass

    store.remove(session_id)
    return jsonify({"removed": True, "sessionId": session_id}), 200
