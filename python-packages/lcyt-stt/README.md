# lcyt-stt

LCYT's self-hosted speech-to-text inference service and dataset pipeline: a
[faster-whisper](https://github.com/SYSTRAN/faster-whisper) (CTranslate2)
server exposing a whisper.cpp-compatible `/inference` API, plus tooling to
turn [crowd-source-voice](https://github.com/jsilvanus/crowd-source-voice)
exports into training-ready dataset snapshots. Background and design
decisions: `docs/plans/plan_local_stt.md` in the main repo.

The existing Node.js `WhisperHttpAdapter`
(`packages/plugins/lcyt-rtmp/src/stt-adapters/whisper-http.js`) already
speaks this service's API — point `WHISPER_HTTP_URL` at it and no backend
code changes are needed.

## Install

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
```

## Run the inference server

```bash
lcyt-stt serve --port 8090
# or: uvicorn lcyt_stt.serve.app:app --host 0.0.0.0 --port 8090
```

Env config:

| Var | Default | Notes |
|---|---|---|
| `LCYT_STT_PORT` | `8090` | Port for `lcyt-stt serve` |
| `LCYT_STT_MODEL` | `Systran/faster-whisper-large-v3-turbo` | HF hub CT2-format model id or local path |
| `LCYT_STT_MODEL_DIR` | (HF cache default) | Download/cache root for model weights |
| `LCYT_STT_DEVICE` | `auto` | `cuda`, `cpu`, or `auto` (try CUDA, fall back to CPU int8) |
| `LCYT_STT_COMPUTE_TYPE` | (device default) | Override CTranslate2 compute type |
| `LCYT_STT_DEFAULT_LANGUAGE` | `fi` | Used when a request omits `language` |
| `LCYT_STT_MAX_QUEUE` | `8` | Inference requests queued before returning 503 |

`GET /health` → `{status, model_id, device, compute_type, loaded}` (503 until the model finishes loading).

`POST /inference` — multipart `file` (any ffmpeg/PyAV-decodable audio), optional `language` (ISO 639-1, default `fi`), optional `model` (accepted for whisper.cpp compatibility, ignored — model switching is a Phase 5 feature). Returns `{text, language, segments}`.

## Dataset pipeline

```bash
export CSV_ADMIN_TOKEN=...   # bearer token for an admin-role crowd-source-voice account
lcyt-stt dataset pull --base-url https://csv.example.org --corpus-id 3 --out snapshots/2026-07-26/
lcyt-stt dataset build --snapshot snapshots/2026-07-26/ --out datasets/fi-v1/
```

`dataset pull` only accepts `type: 'text'` corpora (rejects `music` corpora — those export a `notation` field
instead of `text` and are out of scope here) and writes a `snapshot.json` recording provenance (corpus id,
recording count, total duration, content hash). `dataset build` produces a speaker-disjoint
train/dev/test split using each row's `speaker_id` (a salted hash of the contributor's email, added to
crowd-source-voice's export API specifically for this) when present; if a snapshot predates that field, it
falls back to a seeded random utterance-level split and marks `speaker_disjoint: false` in the built
dataset's metadata rather than silently pretending the split is speaker-disjoint.

## Tests

```bash
pytest
```

Serve-layer tests use stub `ModelHost`/`InferenceQueue` instances — no real model download needed. Dataset-layer tests mock the crowd-source-voice HTTP client — no live server needed.

## Docker

See `docker/lcyt-stt/README.md` in the main repo for CPU/CUDA image builds and compose wiring.
