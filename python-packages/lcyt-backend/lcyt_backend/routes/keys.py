"""CRUD /keys — Admin API key management."""

from flask import Blueprint, current_app, jsonify, request

from ..db import (
    create_key,
    delete_key,
    get_all_keys,
    get_key,
    revoke_key,
    update_key,
)
from ..middleware.admin import require_admin

keys_bp = Blueprint("keys", __name__)


def _format_key(row: dict) -> dict:
    return {
        "key": row["key"],
        "owner": row["owner"],
        "active": bool(row["active"]),
        "expires": row["expires_at"],
        "createdAt": row["created_at"],
    }


@keys_bp.get("/")
@require_admin
def list_keys():
    """GET /keys — List all API keys."""
    db = current_app.config["DB"]
    rows = get_all_keys(db)
    return jsonify({"keys": [_format_key(r) for r in rows]}), 200


@keys_bp.post("/")
@require_admin
def create_api_key():
    """POST /keys — Create a new API key."""
    db = current_app.config["DB"]
    body = request.get_json(silent=True) or {}
    owner = body.get("owner")

    if not owner:
        return jsonify({"error": "owner is required"}), 400

    new_key = create_key(
        db,
        owner=owner,
        key=body.get("key"),
        expires_at=body.get("expires") or None,
    )
    return jsonify(_format_key(new_key)), 201


@keys_bp.get("/<key>")
@require_admin
def get_api_key(key: str):
    """GET /keys/<key> — Get details for a specific key."""
    db = current_app.config["DB"]
    row = get_key(db, key)
    if not row:
        return jsonify({"error": "API key not found"}), 404
    return jsonify(_format_key(row)), 200


@keys_bp.patch("/<key>")
@require_admin
def update_api_key(key: str):
    """PATCH /keys/<key> — Update owner and/or expiration."""
    db = current_app.config["DB"]
    row = get_key(db, key)
    if not row:
        return jsonify({"error": "API key not found"}), 404

    body = request.get_json(silent=True) or {}

    kwargs = {}
    if "owner" in body:
        kwargs["owner"] = body["owner"]
    if "expires" in body:
        kwargs["expires_at"] = body["expires"] or None

    if kwargs:
        update_key(db, key, **kwargs)

    updated = get_key(db, key)
    return jsonify(_format_key(updated)), 200


@keys_bp.delete("/<key>")
@require_admin
def delete_api_key(key: str):
    """DELETE /keys/<key> — Revoke (soft) or permanently delete."""
    db = current_app.config["DB"]
    row = get_key(db, key)
    if not row:
        return jsonify({"error": "API key not found"}), 404

    if request.args.get("permanent") == "true":
        delete_key(db, key)
        return jsonify({"key": key, "deleted": True}), 200
    else:
        revoke_key(db, key)
        return jsonify({"key": key, "revoked": True}), 200
