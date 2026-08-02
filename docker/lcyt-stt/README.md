# lcyt-stt

faster-whisper (CTranslate2) inference server for LCYT's self-hosted STT
(`docs/plans/plan_local_stt.md`, `python-packages/lcyt-stt/`). Exposes a
whisper.cpp-compatible `/inference` API, so the existing Node.js
`WhisperHttpAdapter` (`packages/plugins/lcyt-rtmp/src/stt-adapters/whisper-http.js`)
works against it unchanged — point `WHISPER_HTTP_URL` at this service.

Two variants from one source tree:

- **`Dockerfile`** — CPU only (`python:3.12-slim` + ffmpeg). Runs anywhere; `LCYT_STT_DEVICE=cpu` fixed so startup doesn't waste time probing for a GPU this image can't have.
- **`Dockerfile.cuda`** — GPU (`nvidia/cuda` runtime base). `LCYT_STT_DEVICE=auto` (default): tries CUDA/float16 first, falls back to CPU/int8 if no GPU is visible, so it also runs on a host without a GPU attached — just larger than the CPU image for that case. Requires the NVIDIA Container Toolkit + `--gpus all` (or compose's `deploy.resources.reservations.devices` stanza).

Model weights are **not** baked into either image — they download into `LCYT_STT_MODEL_DIR` (mount a volume there) on first boot.

## Build

The build context is the package source (`python-packages/lcyt-stt`), not this directory:

```bash
# from repo root
docker build -t lcyt-stt:local -f docker/lcyt-stt/Dockerfile python-packages/lcyt-stt
docker build -t lcyt-stt:cuda  -f docker/lcyt-stt/Dockerfile.cuda python-packages/lcyt-stt
```

## Run

```bash
docker run --rm -p 8090:8090 -v lcyt-stt-models:/models \
  -e LCYT_STT_MODEL_DIR=/models lcyt-stt:local

# GPU variant:
docker run --rm --gpus all -p 8090:8090 -v lcyt-stt-models:/models \
  -e LCYT_STT_MODEL_DIR=/models lcyt-stt:cuda
```

## Verify

```bash
# Wait for the model to finish downloading/loading:
curl http://localhost:8090/health
# {"status":"ok","model_id":"Systran/faster-whisper-large-v3-turbo","device":"cpu","compute_type":"int8","loaded":true}

# Transcribe a fixture clip:
curl -F file=@fixture.wav -F language=fi http://localhost:8090/inference
```

Then, for the full end-to-end check (Phase 1 exit criterion): point a dev `lcyt-backend` instance's
`WHISPER_HTTP_URL` at `http://localhost:8090`, start an RTMP/HLS STT session with
`provider: whisper_http`, and confirm captions arrive.

## Compose

`docker-compose.yml` at the repo root has a profile-gated `lcyt-stt` service:

```bash
docker compose --profile lcyt-stt up
```
