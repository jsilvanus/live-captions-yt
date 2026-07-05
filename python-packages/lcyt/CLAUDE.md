# `python-packages/lcyt` — Core Library (v1.2.0)

Published to PyPI. Python 3.10+.

- `lcyt/sender.py` — `YoutubeLiveCaptionSender` + `Caption`/`SendResult` dataclasses. Uses `http.client` (stdlib only).
- `lcyt/backend_sender.py` — `BackendCaptionSender` (relay client).
- `lcyt/config.py` — `LCYTConfig` dataclass, `load_config()`, `save_config()`, `build_ingestion_url()`.
- `lcyt/errors.py` — `LCYTError`, `ConfigError`, `NetworkError`, `ValidationError`.

> **Timestamp difference:** In Python, bare numeric epochs >= 1000 are treated as **seconds** (vs. milliseconds in Node.js). ISO strings use the same format on both platforms: `YYYY-MM-DDTHH:MM:SS.mmm` (no trailing Z).

## Test Coverage

**Test files:** 4 test files, 121 tests — full coverage of sender, backend relay, config, and errors.

**Gaps (Low):** None identified.

---

See root `CLAUDE.md` for the Timestamp Handling and Error Hierarchy conventions shared with the Node.js `packages/lcyt`.
