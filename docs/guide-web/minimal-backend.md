---
title: Python Minimal Backend
order: 9
---

# Python Minimal Backend

The **Python Flask backend** (`python-packages/lcyt-backend`) is a lightweight, self-hostable alternative to the full Node.js backend. It is designed for simple deployments — shared hosting (cPanel / Phusion Passenger), Raspberry Pi, or any environment where Node.js is unavailable or undesirable.

---

## What the minimal backend provides

| Feature | Python backend | Node.js backend |
|---------|---------------|----------------|
| Caption relay to YouTube | ✅ | ✅ |
| NTP clock sync | ✅ | ✅ |
| API key management | ✅ | ✅ |
| Per-key usage stats | ✅ | ✅ |
| JWT session tokens | ✅ (stdlib-only HS256) | ✅ |
| CORS support | ✅ | ✅ |
| User account registration / login | ❌ | ✅ |
| RTMP relay | ❌ | ✅ |
| HLS streaming | ❌ | ✅ |
| DSK graphics overlay | ❌ | ✅ |
| Server-side STT | ❌ | ✅ |
| Caption file storage | ❌ | ✅ |
| Production control (cameras / mixers) | ❌ | ✅ |
| Admin panel | ❌ | ✅ |

The web app detects which backend you are connecting to via `GET /health` feature discovery and automatically **hides UI elements** that are not supported — so the interface stays clean even on a minimal backend.

---

## Deployment: cPanel / Shared Hosting

The Python backend ships a `passenger_wsgi.py` entry point for Phusion Passenger, which is available on most cPanel hosts.

### 1 — Upload files

Upload the contents of `python-packages/lcyt-backend/` to a directory under your cPanel home (e.g. `~/lcyt-backend/`).

### 2 — Install dependencies

Open the **cPanel Terminal** (or SSH):

```bash
cd ~/lcyt-backend
pip install -r requirements.txt
# or install the local library directly:
pip install -e ../lcyt -e .
```

### 3 — Configure environment

Copy `.env.example` to `.env` and edit:

```bash
JWT_SECRET=change-me-to-a-long-random-string
ADMIN_KEY=your-admin-password
DB_PATH=/home/youruser/lcyt-backend/lcyt-backend.db
PORT=3000
```

> **Tip:** Generate a secure secret with `python3 -c "import secrets; print(secrets.token_hex(32))"`.

### 4 — Set up Passenger

In cPanel → **Setup Python App**, point the application root to `~/lcyt-backend/` and set the startup file to `passenger_wsgi.py`.

Passenger will automatically restart the app when the file changes. To trigger a manual restart:

```bash
touch ~/lcyt-backend/passenger_wsgi.py
```

### 5 — Create an API key

Use the admin CLI or make a direct `POST /keys` request with your `ADMIN_KEY`:

```bash
curl -X POST https://your-domain.com/keys \
  -H "X-Admin-Key: your-admin-password" \
  -H "Content-Type: application/json" \
  -d '{"label": "My Key"}'
```

The response contains the `key` value — save this as your LCYT API key.

---

## Deployment: local development

```bash
cd python-packages/lcyt-backend
pip install -e ../lcyt -e .
python run.py
# → Listening on http://localhost:3000
```

---

## Connecting the web app to the minimal backend

When you open the web app and go to `/login`:

1. In the **Backend** dropdown, choose **Minimal** (or enter your custom URL).
2. The app probes `GET /health` on your backend.
3. Because the `login` feature is **not** in the response, the login form changes to **API key only** — no email/password needed.
4. Enter your API key and click **Continue**.

> **No user account is needed** on a minimal backend. The API key is the only credential.

The sidebar will automatically hide features not supported by the minimal backend (RTMP, Graphics, Production, Admin, AI, Projects/Account). You are left with a focused interface for captioning.

---

## API summary

The minimal backend exposes the same core REST API as the Node.js backend:

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | Uptime, session count, features list |
| `POST` | `/live` | Register session → session JWT |
| `GET` | `/live` | Session status |
| `DELETE` | `/live` | Tear down session |
| `POST` | `/captions` | Queue caption(s) |
| `GET` | `/events` | SSE caption delivery results |
| `POST` | `/sync` | NTP clock sync |
| `GET` | `/stats` | Per-key usage stats |
| `GET/POST/PATCH/DELETE` | `/keys` | API key CRUD (admin) |

The `GET /health` response shape:

```json
{
  "ok": true,
  "uptime": 123.4,
  "sessions": 1,
  "features": ["captions", "sync", "stats"]
}
```

The absence of `login`, `rtmp`, `graphics`, `production`, and `admin` in the features list is what triggers the minimal-mode UI in the web app.

---

## Environment variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `JWT_SECRET` | HS256 signing key | auto-generated (warns in log) |
| `ADMIN_KEY` | `X-Admin-Key` header value | none (disables admin) |
| `DB_PATH` | SQLite file path | `./lcyt-backend.db` |
| `SESSION_TTL` | Session timeout (ms) | `7200000` (2 h) |
| `CLEANUP_INTERVAL` | Session sweep interval (ms) | `300000` (5 min) |
| `PORT` | HTTP port | `3000` |

---

## Key differences from the Node.js backend

- **No user accounts** — all auth is API-key based.
- **Stdlib-only JWT** — no `jsonwebtoken` or `PyJWT`; uses Python's `hmac` + `hashlib`.
- **No plugins** — RTMP, DSK, STT, files, production control are not available.
- **Synchronous SQLite** — uses Python's `sqlite3` stdlib; no async DB layer.
- **cPanel-compatible** — `passenger_wsgi.py` provides a WSGI entry point for shared hosting.

---

## Upgrading to the full Node.js backend

If you outgrow the minimal backend, migrate by:

1. Deploying `packages/lcyt-backend/` with Node.js 20+.
2. Running `npm install` from the repo root.
3. Copying your API keys (they use the same format).
4. Pointing the web app at the new backend URL and re-authenticating.

All captions sent through the minimal backend are delivered the same way — there is no data to migrate.
