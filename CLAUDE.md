# live-captions-yt

## Overview

Monorepo: CLI tool and library for sending live captions to YouTube Live via Google's HTTP POST caption ingestion API.

## Structure

### Node.js packages (`packages/`)
- `packages/lcyt/` — Core Node.js library (published to npm as `lcyt`)
  - `src/` — ESM source (sender.js, config.js, logger.js, errors.js)
  - `dist/` — CJS build output
- `packages/lcyt-cli/` — CLI tool (published to npm as `lcyt-cli`)
  - `bin/lcyt` — CLI entrypoint (ESM, shebang script)
  - `src/interactive-ui.js` — Full-screen blessed UI
- `packages/lcyt-backend/` — Node.js Express backend

### Python packages (`python-packages/`)
- `python-packages/lcyt/` — Python library (published to PyPI as `lcyt`)
  - `lcyt/` — Package source (sender.py, config.py, errors.py)
  - `pyproject.toml` — Package config
- `python-packages/lcyt-backend/` — Python/Flask backend (cPanel/Passenger compatible)
  - `lcyt_backend/` — Package source
    - `app.py` — Flask app factory
    - `db.py` — SQLite operations
    - `store.py` — In-memory session store
    - `_jwt.py` — Stdlib-only HS256 JWT (no external crypto deps)
    - `routes/` — live.py, captions.py, sync.py, keys.py
    - `middleware/` — auth.py, admin.py, cors.py
  - `passenger_wsgi.py` — cPanel Phusion Passenger entry point
  - `run.py` — Development server
  - `tests/` — pytest test suite
  - `pyproject.toml` — Package config
  - `requirements.txt` — pip requirements

> **Note:** `python/` still exists as legacy source. The canonical Python packages are in `python-packages/`.

## Setup

```bash
npm install          # Must run at repo root — creates workspace symlinks in node_modules/
```

## Commands

```bash
npm run build        # Build lcyt CJS output (ESM→CJS via packages/lcyt/scripts/build-cjs.js)
npm test             # Run tests across all packages
npm start            # Run lcyt-cli (packages/lcyt-cli)
```

## CLI Usage

```bash
node_modules/.bin/lcyt                     # Full-screen mode
node_modules/.bin/lcyt "Hello, world!"    # Send single caption
node_modules/.bin/lcyt /batch "text"      # Batch mode
node_modules/.bin/lcyt --stream-key KEY   # Set stream key
node_modules/.bin/lcyt --heartbeat        # Test connection
```

## lcyt Package Exports

- `lcyt` → `YoutubeLiveCaptionSender`
- `lcyt/config` → config utilities
- `lcyt/logger` → logger
- `lcyt/errors` → error classes

Both ESM (`src/`) and CJS (`dist/`) are provided.

## Key Files

- `package.json` — root workspace config (workspaces: packages/lcyt, packages/lcyt-cli)
- `packages/lcyt/package.json` — exports map for ESM/CJS dual package
- `packages/lcyt/scripts/build-cjs.js` — custom ESM→CJS transformer
- `packages/lcyt-cli/bin/lcyt` — CLI entrypoint
- `packages/lcyt-cli/src/interactive-ui.js` — full-screen blessed UI
- `python-packages/lcyt-backend/passenger_wsgi.py` — cPanel entry point
- `python-packages/lcyt-backend/run.py` — dev server

## Python Backend Commands

```bash
# Install (from python-packages/lcyt-backend/)
pip install -r requirements.txt
# or: pip install -e ../lcyt -e .

# Run dev server
python run.py

# Run tests
pytest
```
