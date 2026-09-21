# STT Service Runbook (liturgos-auditor)

## Overview

The STT (speech-to-text) service is a standalone FastAPI + faster-whisper inference server running in the `liturgos-auditor` repository. It provides speech recognition for live stream caption generation via two compatible APIs:
- **whisper.cpp-compatible** `/inference` endpoint (used by `WhisperHttpAdapter`)
- **OpenAI-compatible** `/v1/audio/transcriptions` endpoint (used by `OpenAiAdapter`)

The service auto-detects NVIDIA CUDA GPUs and falls back to CPU int8 quantization. It handles a bounded queue of inference requests (default max 8 concurrent).

---

## Configuration

### Environment Variables (service-side)

Set these on the STT service host:

| Variable | Default | Notes |
|----------|---------|-------|
| `AUDITOR_STT_PORT` | `8090` | HTTP server port |
| `AUDITOR_STT_DEVICE` | `auto` | `cuda`, `cpu`, or `auto` (detect GPU, fallback to CPU) |
| `AUDITOR_STT_MODEL` | `large-v3-turbo` | Model ID or `registry:name[@version]` for a fine-tuned model |
| `AUDITOR_STT_MODEL_DIR` | `./models` | Directory where models are stored or downloaded |
| `AUDITOR_STT_DEFAULT_LANGUAGE` | `fi` | Default language code (ISO 639-1) when not specified in requests |
| `AUDITOR_STT_MAX_QUEUE` | `8` | Maximum live inference requests queued; excess rejected with 503 |
| `AUDITOR_STT_API_KEY` | — | If set, all endpoints except `/health` require `Authorization: Bearer <key>` |
| `AUDITOR_STT_DATA_DIR` | — | If set, enables batch jobs API (`/v1/jobs`) |

### LCYT-side Configuration

Configure lcyt to use the STT service via one of two providers:

#### Option 1: Whisper HTTP (no auth required)

Use when the service has no `AUDITOR_STT_API_KEY` set (or uses network isolation).

In lcyt-backend settings or `.env`:
```bash
STT_PROVIDER=whisper_http
WHISPER_HTTP_URL=http://auditor-stt:8090  # or http://<host>:8090
```

#### Option 2: OpenAI-compatible (auth available)

Use when the service has `AUDITOR_STT_API_KEY` set for authentication.

In lcyt-backend settings or `.env`:
```bash
STT_PROVIDER=openai
OPENAI_STT_URL=http://auditor-stt:8090      # or http://<host>:8090
OPENAI_STT_API_KEY=<same_key_as_AUDITOR_STT_API_KEY>
```

---

## Health Check

Query the service health:

```bash
curl http://auditor-stt:8090/health
```

Response when model is ready:
```json
{
  "status": "ready",
  "model_id": "large-v3-turbo",
  "device": "cuda",
  "compute_type": "float16",
  "loaded": true
}
```

Response while model is loading:
```json
{
  "status": "loading",
  "loaded": false
}
```

HTTP 503 is returned while loading or after a failed load.

Check queue depth and model info:

```bash
curl http://auditor-stt:8090/status
```

---

## Troubleshooting

### 422 "Could not decode audio" and caption loss

**Cause:** (1) The audio bytes are corrupted or in an unsupported format. (2) Most common: HLS fMP4 segments lack the MP4 init segment (`ftyp`, `moov` boxes).

**Fix (in lcyt):** lcyt's `HlsSegmentFetcher` automatically:
- Fetches and caches the `#EXT-X-MAP` init segment from the playlist
- Prepends init bytes to every media segment before sending to the service
- On init fetch failure (transient network error, service restart): emits error, **skips that poll's segments** (live captions are lost until recovery), and retries the init fetch on the next poll cycle

This means: transient init failures cause caption loss during the failure (duration ≤ segment interval, typically ~5–15 s), with recovery when the init fetch succeeds. Verify lcyt-rtmp is up-to-date.

**Workaround:** If using a non-HLS audio source, ensure the audio is a complete, decodable file (WAV, MP3, MP4, etc.). The service decodes via ffmpeg and PyAV.

### 503 "Inference queue depth exceeded"

**Cause:** The service is overloaded. More than `AUDITOR_STT_MAX_QUEUE` (default 8) inference requests are queued.

**Options:**
1. **Increase queue size** (service-side):
   ```bash
   AUDITOR_STT_MAX_QUEUE=16 auditor-stt serve
   ```
   Risk: higher latency under load. YouTube caption ingestion budget is ~25 s; target ≤ 10 s end-to-end (including transcription).

2. **Add GPU resources:** If the service is CPU-only or has an older GPU, upgrade to reduce inference time per request. Faster inference = shorter queue times.

3. **Reduce chunk rate** (lcyt-side): If lcyt is sending audio chunks too frequently, increase the segment duration or polling interval in `SttManager`.

### Model fails to load

**Cause:** Model file is missing or corrupted; model download failed; insufficient VRAM for GPU.

**Check logs:**
```bash
docker logs auditor-stt
```

**Fix:**
1. Verify `AUDITOR_STT_MODEL_DIR` is writable and has adequate disk space (~2 GB for large-v3-turbo).
2. Delete corrupted model and retry (it will re-download):
   ```bash
   rm -rf models/large-v3-turbo*
   ```
3. If running on GPU, check `nvidia-smi` for memory allocation. If insufficient, either:
   - Reduce batch size or use CPU int8 instead (`AUDITOR_STT_DEVICE=cpu`)
   - Upgrade GPU memory

### Timeout errors in lcyt logs

**Cause:** Transcription is taking longer than the adapter's timeout (60 seconds for whisper.cpp, 60 seconds for OpenAI adapters).

**Fix:**
1. Check queue depth (`/status`). If high, refer to "503 queue depth" section above.
2. If queue is normal but inference is slow, profile the model:
   - Check `nvidia-smi` (GPU utilization, memory).
   - Check CPU/memory on the STT host.
   - If CPU-bound and feasible, switch to GPU or add more vCPUs.

### Empty transcripts (no error, just "")

**Cause:** The audio is silence, music, or noise with no recognizable speech. This is expected behavior, not an error.

**Confirmation:** Check the service's response; if `"text": ""` and `segments: []`, silence is likely.

**Workaround:** Increase the confidence threshold or use a larger model (e.g., `large-v3` instead of `large-v3-turbo`), but note this increases inference time and may exceed the latency budget.

---

## Deployment

### Docker Compose

In `docker-compose.yml`, the service is optional (profile `stt`):

```bash
docker compose --profile stt up -d auditor-stt
```

The CPU image is the default. For CUDA, set `DOCKER_IMAGE`:

```bash
DOCKER_IMAGE=auditor-stt:latest-cuda docker compose --profile stt up -d auditor-stt
```

Or modify the compose file to use the CUDA image directly.

### Manual Docker

CPU:
```bash
docker run -d --name auditor-stt \
  -p 8090:8090 \
  -v models:/app/models \
  -e AUDITOR_STT_MODEL=large-v3-turbo \
  auditor-stt:latest
```

CUDA (with GPU):
```bash
docker run -d --name auditor-stt \
  -p 8090:8090 \
  -v models:/app/models \
  --gpus all \
  -e AUDITOR_STT_DEVICE=cuda \
  auditor-stt:latest-cuda
```

### Binary / Development

In the `liturgos-auditor` repository:

```bash
auditor-stt serve --port 8090
```

Models download on first start to `./models`. Set `--model-dir` or `AUDITOR_STT_MODEL_DIR` to override.

---

## Model Management

### List available local models

```bash
curl http://auditor-stt:8090/model
```

### Switch model (live, no restart)

```bash
curl -X POST http://auditor-stt:8090/model \
  -H "Content-Type: application/json" \
  -d '{"model": "registry:lcyt-fi-v1@latest"}'
```

Response:
```json
{
  "previous": "large-v3-turbo",
  "current": "registry:lcyt-fi-v1@latest"
}
```

The new model loads in the background; `/health` returns 503 until ready. Inference requests continue on the old model until the new one is ready.

### Rollback

If a new model performs poorly:

```bash
curl -X POST http://auditor-stt:8090/model \
  -H "Content-Type: application/json" \
  -d '{"model": "large-v3-turbo"}'
```

---

## Monitoring

### Prometheus Metrics (if available)

The service may expose Prometheus metrics on `/metrics`:

```bash
curl http://auditor-stt:8090/metrics
```

Check the `liturgos-auditor` docs for available metrics.

### Manual Queue Check

```bash
curl http://auditor-stt:8090/status
```

Look for `queue_depth` (running + queued inference requests).

### LCYT Integration Check

Verify that lcyt is actually sending requests:

1. Start a stream on lcyt (`POST /stt/start`).
2. Check service queue depth:
   ```bash
   while true; do curl http://auditor-stt:8090/status | jq .queue_depth; sleep 2; done
   ```
3. Expect queue_depth > 0 while audio is flowing. If it stays 0, check lcyt logs for adapter errors.

---

## End-to-End Verification

**Not yet completed.** The following end-to-end test should be run before production deployment:

1. Start lcyt with an RTMP publisher (OBS, ffmpeg).
2. POST to `lcyt-backend:3000/stt/start` with `provider: whisper_http` and valid API key.
3. Verify captions appear in the UI or via `GET /stt/:apiKey`.
4. Check that transcription latency is acceptable (~5–10 s from audio to caption).
5. Stop and verify cleanup (segment fetcher stops, adapter stops, no orphaned processes).

This test exercises the full audio → HLS → segment fetch → init segment prepend → STT → transcript → caption pipeline. Until this test passes, the service is not production-ready.

---

## References

- `liturgos-auditor` README: overview, quick start, all endpoints
- `liturgos-auditor` docs/integration.md: detailed API contract (whisper.cpp and OpenAI-compatible)
- `live-captions-yt` docs/plans/plan_local_stt.md: architectural motivation and long-term roadmap
- `live-captions-yt` PORTS.md: port assignments
