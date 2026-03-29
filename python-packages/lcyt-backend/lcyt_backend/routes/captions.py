"""POST /captions — Send captions through the session's sender (Bearer auth)."""

from flask import Blueprint, current_app, g, jsonify, request

from ..middleware.auth import require_auth

captions_bp = Blueprint("captions", __name__)


@captions_bp.post("/")
@require_auth
def send_captions():
    """POST /captions — Send one or more captions (auth via Bearer token).

    Request body:
        {
            "captions": [{"text": "Hello", "timestamp": "..."}]
        }
    """
    senders = current_app.config["SENDERS"]
    session_id = g.session["sessionId"]
    entry = senders.get(session_id)

    if not entry:
        return jsonify({"error": "Session not found"}), 404

    body = request.get_json(silent=True) or {}
    captions = body.get("captions")

    if not isinstance(captions, list) or len(captions) == 0:
        return jsonify({"error": "captions must be a non-empty array"}), 400

    try:
        from lcyt.sender import Caption  # type: ignore[import]

        sender = entry["sender"]

        resolved = []
        for caption in captions:
            text = caption.get("text", "")
            ts = caption.get("timestamp")
            resolved.append({"text": text, "timestamp": ts})

        caption_objs = [Caption(text=c["text"], timestamp=c["timestamp"]) for c in resolved]

        if len(caption_objs) == 1:
            result = sender.send(caption_objs[0].text, caption_objs[0].timestamp)
        else:
            result = sender.send_batch(caption_objs)

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
