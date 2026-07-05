# `python-packages/lcyt-backend` — Flask Backend (v1.0.0)

Feature parity with the Node.js backend. cPanel/Phusion Passenger compatible.

**Key files:**
- `lcyt_backend/app.py` — Flask app factory
- `lcyt_backend/db.py` — SQLite via stdlib `sqlite3`
- `lcyt_backend/store.py` — in-memory session store
- `lcyt_backend/_jwt.py` — **stdlib-only HS256 JWT** using `hmac` + `hashlib` (no external crypto dep)
- `lcyt_backend/routes/` — `live.py`, `captions.py`, `sync.py`, `keys.py` (Flask blueprints)
- `lcyt_backend/middleware/` — `auth.py`, `cors.py`, `admin.py`
- `passenger_wsgi.py` — cPanel entry point (`application = create_app()`)
- `run.py` — development server

**Commands:**
```bash
# from python-packages/lcyt-backend/
python run.py      # dev server
pytest             # run tests
```

**Tests:** `tests/test_*.py` with `conftest.py` fixtures.

## Test Coverage

**Test files:** 8 test files (~70 tests) — all primary routes (live, captions, sync, keys), DB, session store, JWT.

**Gaps (Medium):**
- `middleware/cors.py` — dynamic origin validation.
- Feature parity gaps vs. Node.js backend (no file management, stats, usage, viewer, icons routes tested).

---

This is the "minimal" backend preset referenced by `packages/lcyt-web`'s two-phase login (`https://minimal.lcyt.fi`) — it does not expose the `login` feature by default, so lcyt-web falls back to API-key-only auth. See `packages/lcyt-backend/CLAUDE.md` for the full-featured Node.js equivalent.
