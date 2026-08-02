# `python-packages/lcyt-stt` — Self-Hosted STT Service + Dataset Pipeline

See `docs/plans/plan_local_stt.md` for the full design (motivation, decisions, phases). This package covers Phase 1 (inference service) and Phase 2 (dataset pipeline) of that plan.

**Key files:**
- `lcyt_stt/serve/app.py` — `create_app(model_host=None, queue=None)`: FastAPI app factory. `POST /inference` (whisper.cpp-compatible multipart), `GET /health`. Accepts `model_host`/`queue` overrides so tests can inject stubs without touching env vars or loading a real model.
- `lcyt_stt/serve/model.py` — `ModelHost`: lazy-loads a faster-whisper `WhisperModel`; tries CUDA/float16 then falls back to CPU/int8 unless a specific `device` was requested. `faster_whisper` is imported lazily inside `load()` so importing this module (and `app.py`) never requires the model library to actually load.
- `lcyt_stt/serve/audio.py` — `temp_audio_file()`: stages uploaded bytes to a suffixed temp file; faster-whisper decodes the container itself via PyAV, so no separate ffmpeg subprocess is needed here.
- `lcyt_stt/serve/queue.py` — `InferenceQueue`: bounded single-worker queue (`asyncio.Lock` + depth counter); raises `QueueFullError` (→ 503) past `max_queue` instead of letting a backlog build latency.
- `lcyt_stt/dataset/client.py`, `pull.py`, `build.py`, `normalize.py` — crowd-source-voice export client, snapshot pull (validates `corpus.type == 'text'`, rejects `music`), HF `datasets` build with speaker-disjoint split (via the `speaker_id` field added to that platform's export API — see its own `server/utils/speakerId.js`), and Finnish text normalization.
- `lcyt_stt/cli.py` — `lcyt-stt serve` / `lcyt-stt dataset pull` / `lcyt-stt dataset build` (argparse entry point, registered as the `lcyt-stt` console script).

**Commands:**
```bash
# from python-packages/lcyt-stt/
python3 -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
pytest                 # serve-layer tests use stub ModelHost/InferenceQueue; dataset tests mock the HTTP client
lcyt-stt serve --port 8090
```

**Integration seam:** the Node.js `WhisperHttpAdapter` (`packages/plugins/lcyt-rtmp/src/stt-adapters/whisper-http.js`) already speaks this service's `/inference` API — point `WHISPER_HTTP_URL` at it, no Node.js changes needed. Corresponding backend settings already exist: `stt.whisper_http_url` / `stt.whisper_http_model` (`packages/lcyt-backend/src/settings/registry.js`).

**Docker:** `docker/lcyt-stt/Dockerfile` (CPU) and `Dockerfile.cuda` (GPU) at the repo root's `docker/` dir — see that directory's README for build/run instructions. Compose wiring is in the repo root `docker-compose.yml` under the `lcyt-stt` profile.

## Test Coverage

- `tests/test_health.py` — `/health` before/after model load.
- `tests/test_inference_shape.py` — multipart parsing, language defaulting to `fi`, 503 when the model isn't loaded yet.
- `tests/test_queue_overflow.py` — queue-depth rejection and in-capacity sequential processing.
- `tests/test_dataset_pull.py`, `tests/test_dataset_build.py` — mocked crowd-source-voice client; no live server needed.

**Gaps:** no integration test against a real faster-whisper model load (would need real weights downloaded — out of scope for CI; see the repo's `docker/lcyt-stt/README.md` for the manual E2E verification steps instead). No live crowd-source-voice smoke test in CI (documented as a manual operator step).
