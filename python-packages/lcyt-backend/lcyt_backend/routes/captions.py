"""POST /captions — Send captions through the session's sender."""

import time
from datetime import datetime, timezone

from flask import Blueprint, current_app, g, jsonify, request

from ..middleware.auth import require_auth

captions_bp = Blueprint("captions", __name__)


@captions_bp.post("/")
@require_auth
def send_captions():
    """POST /captions — Send one or more captions (auth required)."""
    store = current_app.config["STORE"]

    body = request.get_json(silent=True) or {}
    captions = body.get("captions")

    if not isinstance(captions, list) or len(captions) == 0:
        return jsonify({"error": "captions must be a non-empty array"}), 400

    session_id = g.session["sessionId"]
    session = store.get(session_id)
    if not session:
        return jsonify({"error": "Session not found"}), 404

    # Resolve relative `time` fields to absolute datetime timestamps.
    # time (ms since session start) + session.started_at + session.sync_offset (ms)
    resolved = []
    for caption in captions:
        text = caption.get("text", "")
        ts = caption.get("timestamp")
        rel_time = caption.get("time")  # ms since session start

        if rel_time is not None and ts is None:
            abs_ms = session["started_at"] * 1000 + rel_time + session["sync_offset"]
            ts = datetime.fromtimestamp(abs_ms / 1000, tz=timezone.utc)

        resolved.append({"text": text, "timestamp": ts})

    try:
        from lcyt.sender import Caption  # type: ignore[import]

        sender = session["sender"]

        caption_objs = [Caption(text=c["text"], timestamp=c["timestamp"]) for c in resolved]

        if len(caption_objs) == 1:
            result = sender.send(caption_objs[0].text, caption_objs[0].timestamp)
        else:
            result = sender.send_batch(caption_objs)

        # Sync sequence from sender
        session["sequence"] = sender.get_sequence()
        store.touch(session_id)

        if 200 <= result.status_code < 300:
            if len(caption_objs) == 1:
                return jsonify({
                    "sequence": result.sequence,
                    "timestamp": str(resolved[0]["timestamp"]) if resolved[0]["timestamp"] else None,
                    "statusCode": result.status_code,
                    "serverTimestamp": result.server_timestamp,
                }), 200
            else:
                return jsonify({
                    "sequence": result.sequence,
                    "count": result.count,
                    "statusCode": result.status_code,
                    "serverTimestamp": result.server_timestamp,
                }), 200
        else:
            return jsonify({
                "error": f"YouTube returned status {result.status_code}",
                "statusCode": result.status_code,
                "sequence": result.sequence,
            }), result.status_code

    except Exception as exc:
        return jsonify({
            "error": str(exc) or "Failed to send captions",
            "statusCode": 502,
        }), 502
