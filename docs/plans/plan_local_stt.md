---
id: plan/local-stt
title: "Local STT Service (`lcyt-stt`) — Self-Hosted, Trainable Finnish Speech-to-Text"
status: draft
summary: "LCYT's own STT inference service + training pipeline: a containerized faster-whisper server (whisper.cpp-compatible /inference API, GPU auto-detect with CPU int8 fallback) serving Whisper models fine-tuned on Finnish data crowdsourced via the companion crowd-source-voice platform. Covers dataset ingestion from the crowdsource export API, hardware-agnostic fine-tuning scripts (full + LoRA), CTranslate2 conversion, a WER/CER evaluation gate against a real-service eval set, and versioned model artifacts. Integrates with the existing SttManager through the unchanged WhisperHttpAdapter."
---

# Local STT Service (`lcyt-stt`)

**Scope:** New Python package `python-packages/lcyt-stt/` (inference server + dataset/training/eval tooling); new Docker build contexts `docker/lcyt-stt/` (CPU and CUDA variants); docker-compose wiring; small optional additions to `packages/plugins/lcyt-rtmp` (named provider alias + health surfacing). **No changes to the existing STT adapter contract** — the service speaks the whisper.cpp HTTP API that `WhisperHttpAdapter` already implements.

**Companion repository:** [`jsilvanus/crowd-source-voice`](https://github.com/jsilvanus/crowd-source-voice) — the crowdsourcing platform that produces the training data. It is a separate project with its own lifecycle; this plan treats its **export API as a stable input contract**, not as code to modify.

---

## Motivation

Server-side STT (plan_server_stt.md, implemented) supports three providers: Google Cloud STT, any whisper.cpp-compatible HTTP server, and OpenAI-compatible endpoints. All three have the same gap for LCYT's primary use case — **live Finnish church-service captioning**:

- **Finnish quality.** Stock Whisper's Finnish is serviceable but weak on domain vocabulary: proper names, hymn titles, liturgical and biblical terms, and the recurring speakers of a given congregation. Google's Finnish is better but costs per minute and sends congregation audio to a third party.
- **No ownership.** `WhisperHttpAdapter` assumes the operator runs a whisper.cpp server somewhere; LCYT does not ship, deploy, version, or health-check it. There is no Docker image, no compose service, nothing in the deployment story.
- **No improvement loop.** None of the providers can be trained. A dataset of ~40 GB of paired Finnish audio (hundreds of hours at 16 kHz mono WAV) is being collected via the crowd-source-voice platform specifically to close this gap.

This plan gives LCYT its own STT engine: fine-tuned on that data, self-hosted, versioned, and improving as the dataset grows.

### Latency budget

YouTube's HTTP caption ingestion displays ~30 s behind live; the working room is ~25 s. The target is **final transcript ≤ 10 s after audio-chunk close**, leaving margin for translation, composition, and delivery.

faster-whisper with `large-v3-turbo`:
- **GPU** (any recent NVIDIA card): a 10 s chunk transcribes in well under 1 s. Trivially inside budget.
- **CPU** (int8 quantized, 8 modern vCPUs): real-time factor roughly 0.2–0.4 → a 10 s chunk in ~2–4 s. Inside budget with headroom.

Both paths are therefore viable, which motivates the auto-detect design below.

---

## Decisions (from planning discussion, 2026-07-19)

| Question | Decision |
|---|---|
| Base model | `whisper-large-v3-turbo` (809 M params) — best speed/quality point for fine-tuning; larger teacher + distillation is explicitly future work |
| Inference runtime | **faster-whisper** (CTranslate2) — one image, **auto-detects GPU, falls back to CPU int8** ("both / decide per deployment") |
| Inference API | **whisper.cpp-compatible `/inference`** so the existing `WhisperHttpAdapter` works unchanged; OpenAI-compatible route optional later |
| Training hardware | **Decide later** — scripts stay hardware-agnostic (plain PyTorch + Hugging Face `transformers`/`peft`); provisioning (cloud GPU rental vs. own hardware) is deliberately out of scope |
| Training data | crowd-source-voice **validated export only** (≥ 2 validations, avg score ≥ 4.0); utterance-level 16 kHz mono WAV, 0.5–30 s — already Whisper-training-ready, no alignment or resegmentation needed |
| Fine-tune style | Full fine-tune as the primary path (dataset scale supports it); LoRA kept as a config option for cheap iteration on small GPUs |
| Primary language | Finnish (`fi`); the service remains multilingual — untuned languages fall through to base-model behaviour |

---

## Input contract: crowd-source-voice export

The crowdsource platform's admin export API is the dataset source of truth:

- `GET /api/export?corpus_id=&format=csv|json` — validated recordings, Whisper-compatible: `file,text,duration,quality_score` (files numbered `0001.wav`, …). `include_all=true` exists but is **never** used for training.
- `GET /api/export/manifest?corpus_id=` — maps export filenames to actual stored file paths, for scripting the audio copy.
- Audio is browser-recorded **16 kHz mono WAV**, gated at capture time (0.5–30 s, < 70 % silence) and crowd-validated afterward.
- Prompts are ~15-word text chunks → training utterances are short, matching the live-captioning inference pattern of 5–15 s audio windows. This train/inference distribution match is a deliberate asset; keep prompt chunking policy stable on the crowdsource side.
- Music corpora (ABC notation) also export; they are **out of scope** here (possible future input to `lcyt-music`).

**Dataset snapshots:** every training run consumes an immutable snapshot — the export CSV + audio files copied at a point in time, content-hashed and given a snapshot id. Model artifacts record their snapshot id (see Phase 3), so any model is reproducible and auditable.

### Data protection note

Voice recordings are personal data, and a congregation-context corpus can imply religious affiliation (GDPR special category). The crowdsource platform already handles the hard part at the right layer: explicit recording consent before contribution, ToS covering research-dataset release and post-release irrevocability, anonymize-or-delete account options. This plan adds only two obligations on the LCYT side: (1) training consumes **only** the consented, validated export; (2) each released model version records which dataset snapshot it was trained on. Raw snapshot storage lives on infrastructure the project controls (see Phase 2), not third-party ML platforms.

---

## Architecture Overview

```
┌─ crowd-source-voice (separate repo/deployment) ────────────┐
│  contributors record → crowd validates → admin export API  │
└──────────────────────┬─────────────────────────────────────┘
                       │ snapshot pull (Phase 2)
                       ▼
┌─ python-packages/lcyt-stt ─────────────────────────────────┐
│  dataset/   snapshot → HF dataset, train/dev/test split    │
│  train/     fine-tune (full | LoRA) → HF checkpoint        │
│  convert/   HF checkpoint → CTranslate2 (+ int8)           │
│  eval/      WER/CER vs. held-out + real-service eval set   │
│  serve/     FastAPI + faster-whisper inference server      │
└──────────────────────┬─────────────────────────────────────┘
                       │ versioned model artifact (Phase 3)
                       ▼
┌─ lcyt-stt service (docker/lcyt-stt, compose) ──────────────┐
│  GET  /health            model id, device, load status     │
│  POST /inference         whisper.cpp-compatible multipart  │
│  GET/POST /model         list / switch model versions      │
└──────────────────────┬─────────────────────────────────────┘
                       │ WHISPER_HTTP_URL=http://lcyt-stt:8090
                       ▼
┌─ existing LCYT pipeline (unchanged) ───────────────────────┐
│  HlsSegmentFetcher → SttManager → WhisperHttpAdapter       │
│    → transcript → translation → caption fan-out → YouTube  │
└────────────────────────────────────────────────────────────┘
```

The integration seam is the whole point: because `WhisperHttpAdapter` already speaks the whisper.cpp `/inference` protocol, **Phase 1 requires zero changes to LCYT's Node.js code** — point `WHISPER_HTTP_URL` at the new service and the existing HLS/RTMP/WHEP → transcript → fan-out pipeline just works.

---

## Phase 1 — Inference service MVP

New package `python-packages/lcyt-stt/` (`pyproject.toml`, published nowhere — deployed as a container).

**Server (`lcyt_stt/serve/`):** FastAPI + uvicorn.

- `POST /inference` — whisper.cpp-compatible: multipart `file` (any ffmpeg-decodable format — the LCYT adapter sends fMP4/AAC segments and WAV, so decode via ffmpeg/PyAV to 16 kHz mono PCM first), optional `language` (short ISO 639-1; default `fi`), optional `model`. Response: `{ "text": "...", "language": "...", "segments": [...] }` — the adapter reads only top-level `text`, everything else is best-effort compatibility.
- `GET /health` — `{ status, model_id, device, compute_type, loaded }`. Returns 503 until the model is loaded (models load lazily/at boot from a local model dir).
- Device selection: try CUDA (`float16`), fall back to CPU (`int8`). Overridable via `LCYT_STT_DEVICE=cuda|cpu|auto` and `LCYT_STT_COMPUTE_TYPE`.
- Single-worker inference with a bounded internal queue: chunks arrive every ~5–15 s per session; concurrent sessions queue. Reject with 503 when queue depth exceeds a limit (`LCYT_STT_MAX_QUEUE`, default 8) rather than building unbounded latency — the adapter already treats errors as skip-and-continue.
- Env config: `LCYT_STT_PORT` (default **8090** — register in `PORTS.md`), `LCYT_STT_MODEL_DIR`, `LCYT_STT_MODEL` (default model id; stock `large-v3-turbo` CT2 build until a fine-tune exists), `LCYT_STT_DEFAULT_LANGUAGE=fi`.

**Docker (`docker/lcyt-stt/`):** two Dockerfiles from one source tree — `Dockerfile` (CPU: `python:3.12-slim` + ffmpeg; runs anywhere) and `Dockerfile.cuda` (`nvidia/cuda` runtime base). Model weights are **not** baked into the image; they mount or download into `LCYT_STT_MODEL_DIR` at first boot.

**Compose:** optional `lcyt-stt` service in `docker-compose.yml` (profile-gated, CPU image, named volume for the model dir) with backend env `WHISPER_HTTP_URL=http://lcyt-stt:8090`. Document the `deploy.resources.reservations.devices` stanza for hosts that want the CUDA image.

**Tests:** `pytest` — API-shape tests with a stubbed model (multipart parsing, language defaulting, health states, queue rejection), plus an optional marked integration test that runs a tiny real model against a fixture WAV.

**Verification:** E2E against a live LCYT stack — RTMP ingest → `POST /stt/start` with `provider: whisper_http` → captions arrive. This is the Phase 1 exit criterion.

---

## Phase 2 — Dataset pipeline

`lcyt_stt/dataset/` — turns crowdsource exports into immutable training snapshots.

- `lcyt-stt dataset pull --base-url … --corpus-id … --out snapshots/<date>/` — authenticates against crowd-source-voice (admin JWT via env), downloads the validated CSV export + manifest, copies audio files (manifest-driven; supports both API download and direct-filesystem copy for a co-hosted deployment), verifies durations, and writes `snapshot.json`: created-at, corpus ids, recording count, total hours, content hash. Snapshots are append-only.
- `lcyt-stt dataset build --snapshot … --out …` — converts a snapshot to a Hugging Face `datasets` audio dataset with a deterministic, seeded **speaker-disjoint** train/dev/test split (split by anonymized contributor id, not by utterance — the crowdsource export must carry a stable anonymous speaker id per row; if the current export lacks it, request it as a small addition to the export format on the crowdsource side). Text normalization: lowercase-free (Whisper is cased), strip prompt artifacts, NFC-normalize; keep Finnish orthography untouched.
- Storage: snapshots live on project-controlled storage (local disk or the project's S3 bucket — same bucket family `lcyt-files` already uses; plain `aws s3 sync` is sufficient, no adapter code needed).

---

## Phase 3 — Training pipeline

`lcyt_stt/train/` — hardware-agnostic (any CUDA box: rented cloud instance or own hardware; provisioning deliberately unscoped per the planning decision).

- Single entry point `lcyt-stt train --config configs/fi-turbo-full.yaml`. Config declares: base model, snapshot path, full-vs-LoRA, epochs, LR schedule, batch/grad-accum (tuned by available VRAM), SpecAugment, eval cadence. Plain `transformers` `Seq2SeqTrainer` + `peft` for the LoRA path — no proprietary trainer, no cloud-vendor SDK.
- Checkpointing + resume (spot-instance friendly). Dev-set WER evaluated during training; best checkpoint kept.
- `lcyt-stt convert --checkpoint … --out …` — HF checkpoint → CTranslate2 via `ct2-transformers-converter`, producing both `float16` and `int8` variants.
- Output is a **versioned model artifact**: `models/lcyt-fi-<semver>/` containing the CT2 model, tokenizer files, and `model.json` (base model, snapshot id + hash, training config, final dev/test WER/CER, created-at). Artifacts upload to the same S3 area as snapshots; the inference service's `LCYT_STT_MODEL_DIR` is populated from there.

**VRAM guidance (documented in the package README, not enforced):** full fine-tune of turbo fits in ~24 GB with bf16 + grad checkpointing; LoRA fits in ~10 GB. Neither requires multi-GPU at this dataset scale.

---

## Phase 4 — Evaluation harness & promotion gate

`lcyt_stt/eval/` — no model ships on vibes.

- **Held-out test set** from the snapshot split (speaker-disjoint) — measures crowdsource-domain quality.
- **Real-service eval set** — the metric that actually matters: 30–60 min of genuine service recordings (spontaneous speech, room mic, one speaker) with hand-corrected transcripts, stored as a small fixed corpus alongside snapshots. Crowdsourced *read* speech differs from *spontaneous sermon* speech; without this set we'd optimize the wrong thing. Building it is a one-time manual task (LCYT's own caption archive is a good starting point for draft transcripts to correct).
- `lcyt-stt eval --model … --sets heldout,service` → WER/CER per set (Finnish-aware normalization before scoring: case-fold, strip punctuation, normalize compound hyphens), plus RTF on the eval host. Results append to the artifact's `model.json`.
- **Promotion rule:** a new model version becomes the service default only if it beats the currently deployed version on the real-service set and does not regress > 1 % absolute WER on held-out. Otherwise it stays available but non-default.
- If stock `large-v3-turbo` already meets need on the service set (unlikely for Finnish domain vocabulary, but measure first), fine-tuning effort can be re-prioritized — the eval harness is deliberately built **before** the first training run consumes GPU money.

---

## Phase 5 — Model management & LCYT integration polish

- Service `GET /model` (list local model versions + active) and `POST /model` (switch active model; loads new, swaps atomically, unloads old). Restart-free model upgrades.
- `lcyt-rtmp` additions (small, optional):
  - Provider alias `lcyt` in STT config resolving to `WhisperHttpAdapter` with `LCYT_STT_URL` as the server URL — purely cosmetic/UX so operators see "LCYT (oma)" rather than configuring a generic whisper URL.
  - Setup Hub STT card surfaces the service's `/health` (model version, device) when the alias is configured.
- Ops: runbook in `ops/runbooks/` (deploying the service, installing a new model version, rollback = `POST /model` back), `PORTS.md` entry, `.env.example` entries.
- Future orchestrator note (not built now): the worker-daemon/orchestrator layer could schedule STT on GPU workers; out of scope until a real multi-tenant load exists.

---

## Explicit non-goals / future work

- **Streaming partial transcripts** — the current chunked-final model already fits the latency budget; revisit only if sub-chunk latency is ever needed.
- **Distillation** (large-v3 teacher → smaller student) — worthwhile once the dataset passes ~300 h and the full-tune quality is known.
- **Training-run provisioning/automation** (cloud GPU rental scripting, orchestrator training jobs) — deliberately deferred per planning decision.
- **Music corpora** — the crowdsource platform's ABC-notation corpora are a possible future input to `lcyt-music`, not this plan.
- **Modifying crowd-source-voice** — except for requesting the anonymous speaker id in the export (Phase 2), the platform is treated as an external data source.
- **Mixing real-condition (service-recording) data into training** — likely the biggest quality lever after v1, but it needs its own consent/data-handling decision since service recordings are not covered by the crowdsource consent flow.

## Todo

- [ ] Phase 1 — inference service MVP (FastAPI + faster-whisper, `/inference` + `/health`, CPU/CUDA images, compose, E2E via `WhisperHttpAdapter`)
- [ ] Phase 2 — dataset pipeline (snapshot pull/build, speaker-disjoint split; request speaker id in crowdsource export)
- [ ] Phase 3 — training pipeline (config-driven fine-tune, CT2 conversion, versioned artifacts)
- [ ] Phase 4 — eval harness (held-out + real-service sets, promotion gate) — build before first paid training run
- [ ] Phase 5 — model management endpoints, `lcyt` provider alias, Setup Hub health surfacing, runbook
