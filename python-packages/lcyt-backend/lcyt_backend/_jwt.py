"""Minimal HS256 JWT implementation using Python stdlib only.

Replaces PyJWT to avoid the cryptography/cffi dependency.
Only supports HS256 (HMAC-SHA256) — which is all lcyt-backend needs.
"""

import base64
import hashlib
import hmac
import json
import time
from typing import Any

_HEADER = base64.urlsafe_b64encode(
    json.dumps({"alg": "HS256", "typ": "JWT"}).encode()
).rstrip(b"=").decode()


class DecodeError(Exception):
    """Raised when a token cannot be decoded."""


class InvalidSignatureError(DecodeError):
    """Raised when the token signature is invalid."""


class ExpiredSignatureError(DecodeError):
    """Raised when the token has expired."""


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64url_decode(s: str) -> bytes:
    # Add padding
    padding = 4 - len(s) % 4
    if padding != 4:
        s += "=" * padding
    return base64.urlsafe_b64decode(s)


def encode(payload: dict[str, Any], secret: str) -> str:
    """Sign a payload dict as an HS256 JWT.

    Args:
        payload: Claims dict (will be JSON-encoded).
        secret: HMAC secret string.

    Returns:
        Compact JWT string (header.payload.signature).
    """
    payload_b64 = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode())
    signing_input = f"{_HEADER}.{payload_b64}"
    sig = hmac.new(
        secret.encode(), signing_input.encode(), hashlib.sha256
    ).digest()
    return f"{signing_input}.{_b64url_encode(sig)}"


def decode(token: str, secret: str) -> dict[str, Any]:
    """Verify and decode an HS256 JWT.

    Args:
        token: Compact JWT string.
        secret: HMAC secret for verification.

    Returns:
        Decoded payload dict.

    Raises:
        DecodeError: If the token is malformed.
        InvalidSignatureError: If the signature does not match.
        ExpiredSignatureError: If the token has an ``exp`` claim in the past.
    """
    try:
        header_b64, payload_b64, sig_b64 = token.split(".")
    except ValueError:
        raise DecodeError("Token does not have three segments")

    signing_input = f"{header_b64}.{payload_b64}"
    expected_sig = hmac.new(
        secret.encode(), signing_input.encode(), hashlib.sha256
    ).digest()

    try:
        provided_sig = _b64url_decode(sig_b64)
    except Exception:
        raise DecodeError("Invalid base64 in signature")

    if not hmac.compare_digest(expected_sig, provided_sig):
        raise InvalidSignatureError("Signature verification failed")

    try:
        payload = json.loads(_b64url_decode(payload_b64))
    except Exception:
        raise DecodeError("Invalid payload encoding")

    if "exp" in payload and payload["exp"] < time.time():
        raise ExpiredSignatureError("Token has expired")

    return payload


# Expose a PyJWT-compatible exception hierarchy so callers don't need to change
PyJWTError = DecodeError
