---
name: backend-python
summary: |
  Backend (Python) skill: Flask parity with Node backend, stdlib JWT approach,
  packaging, testing with pytest, and deployment guidance.
---

## Purpose
Guidance for maintaining the Python mirror packages in `python-packages/` and
ensuring parity with Node.js behaviour (sessions, JWTs, migrations).

## When to use
- Adding or testing Flask routes for `/live`, `/captions`, `/sync`, etc.
- Implementing stdlib-only HS256 JWT utilities and migration parity.
- Packaging and publishing Python packages to PyPI.

## Quick checklist
- JWT: use HMAC-SHA256 via `hmac` + `hashlib` and validate expiry/claims.
- DB: use `sqlite3` and match schema semantics (timestamps seconds vs ms).
- Tests: `pytest` with fixtures for temp DB and test client.
- Packaging: use `pyproject.toml` or `setup.cfg` with `pip install -e .` for dev.

## Commands
- Run tests:

```bash
cd python-packages/lcyt-backend
pytest
```

- Install editable for dev:

```bash
cd python-packages/lcyt-backend
pip install -e ../lcyt -e .
```

## Outputs
- pytest fixtures, migration notes, parity checklist (timestamps, error types).
