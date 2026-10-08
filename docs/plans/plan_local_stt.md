---
id: plan/local-stt
title: "Local STT Service (`liturgos-auditor`) â€” Self-Hosted, Trainable Finnish Speech-to-Text"
status: superseded
summary: "LCYT's own STT inference service + training pipeline: a containerized faster-whisper server (whisper.cpp-compatible /inference API, OpenAI-compatible /v1/audio/transcriptions endpoint, GPU auto-detect with CPU int8 fallback) serving Whisper models fine-tuned on Finnish data crowdsourced via the companion crowd-source-voice platform. Covers dataset ingestion from the crowdsource export API, hardware-agnostic fine-tuning scripts (full + LoRA), CTranslate2 conversion, a WER/CER evaluation gate against a real-service eval set, and versioned model artifacts. Integrates with the existing SttManager through the unchanged WhisperHttpAdapter and OpenAiAdapter. Implemented in the sibling `liturgos-auditor` repository; the in-repo copy this plan originally described was removed on `chore/retire-lcyt-stt`, see the retirement note below."
---

# Local STT Service (`liturgos-auditor`)

> **Retired (branch `chore/retire-lcyt-stt`).** The service this plan describes was originally
> built here as `python-packages/lcyt-stt/` + `docker/lcyt-stt/`. Development then moved to the
> sibling [`liturgos-auditor`](https://github.com/jsilvanus/liturgos-auditor) repository, where it
> was substantially extended (OpenAI-compatible endpoint, model management, ops runbook, and more).
> This repo's original copy never received those changes and has now been **removed** â€” see the
> git history on this branch for the deletion commit. The plan below is kept for historical record.

**Implementation:** The service is implemented in the sibling `liturgos-auditor` repository (Python package `auditor_stt`, Docker images, trained models registry). LCYT connects via `WhisperHttpAdapter` (`WHISPER_HTTP_URL=http://auditor-stt:8090`, no auth) or `OpenAiAdapter` (`OPENAI_STT_URL=http://auditor-stt:8090`, with `OPENAI_STT_API_KEY` if the service has `AUDITOR_STT_API_KEY` set), as documented in `PORTS.md`. **No changes to the existing STT adapter contract** â€” the service speaks the whisper.cpp `/inference` and OpenAI-compatible `/v1/audio/transcriptions` HTTP APIs that the adapters already implement.

**Companion repository:** [`jsilvanus/crowd-source-voice`](https://github.com/jsilvanus/crowd-source-voice) â€” the crowdsourcing platform that produces the training data. It is a separate project with its own lifecycle; this plan treats its **export API as a stable input contract**, not as code to modify.

---

## Motivation

Server-side STT (plan_server_stt.md, implemented) supports three providers: Google Cloud STT, any whisper.cpp-compatible HTTP server, and OpenAI-compatible endpoints. All three have the same gap for LCYT's primary use case â€” **live Finnish church-service captioning**:

- **Finnish quality.** Stock Whisper's Finnish is serviceable but weak on domain vocabulary: proper names, hymn titles, liturgical and biblical terms, and the recurring speakers of a given congregation. Google's Finnish is better but costs per minute and sends congregation audio to a third party.
- **No ownership.** `WhisperHttpAdapter` assumes the operator runs a whisper.cpp server somewhere; LCYT does not ship, deploy, version, or health-check it. There is no Docker image, no compose service, nothing in the deployment story.
- **No improvement loop.** None of the providers can be trained. A dataset of ~40 GB of paired Finnish audio (hundreds of hours at 16 kHz mono WAV) is being collected via the crowd-source-voice platform specifically to close this gap.

This plan gives LCYT its own STT engine: fine-tuned on that data, self-hosted, versioned, and improving as the dataset grows.

### Latency budget

YouTube's HTTP caption ingestion displays ~30 s behind live; the working room is ~25 s. The target is **final transcript â‰¤ 10 s after audio-chunk close**, leaving margin for translation, composition, and delivery.

faster-whisper with `large-v3-turbo`:
- **GPU** (any recent NVIDIA card): a 10 s chunk transcribes in well under 1 s. Trivially inside budget.
- **CPU** (int8 quantized, 8 modern vCPUs): real-time factor roughly 0.2â€“0.4 â†’ a 10 s chunk in ~2â€“4 s. Inside budget with headroom.

Both paths are therefore viable, which motivates the auto-detect design below.

---

## Decisions (from planning discussion, 2026-07-19)

| Question | Decision |
|---|---|
| Base model | `whisper-large-v3-turbo` (809 M params) â€” best speed/quality point for fine-tuning; larger teacher + distillation is explicitly future work |
| Inference runtime | **faster-whisper** (CTranslate2) â€” one image, **auto-detects GPU, falls back to CPU int8** ("both / decide per deployment") |
| Inference API | **whisper.cpp-compatible `/inference`** so the existing `WhisperHttpAdapter` works unchanged; OpenAI-compatible route optional later |
| Training hardware | **Decide later** â€” scripts stay hardware-agnostic (plain PyTorch + Hugging Face `transformers`/`peft`); provisioning (cloud GPU rental vs. own hardware) is deliberately out of scope |
| Training data | crowd-source-voice **validated export only** (â‰¥ 2 validations, avg score â‰¥ 4.0); utterance-level 16 kHz mono WAV, 0.5â€“30 s â€” already Whisper-training-ready, no alignment or resegmentation needed |
| Fine-tune style | Full fine-tune as the primary path (dataset scale supports it); LoRA kept as a config option for cheap iteration on small GPUs |
| Primary language | Finnish (`fi`); the service remains multilingual â€” untuned languages fall through to base-model behaviour |

---

## Input contract: crowd-source-voice export

The crowdsource platform's admin export API is the dataset source of truth:

- `GET /api/export?corpus_id=&format=csv|json` â€” validated recordings, Whisper-compatible: `file,text,duration,quality_score` (files numbered `0001.wav`, â€¦). `include_all=true` exists but is **never** used for training.
- `GET /api/export/manifest?corpus_id=` â€” maps export filenames to actual stored file paths, for scripting the audio copy.
- Audio is browser-recorded **16 kHz mono WAV**, gated at capture time (0.5â€“30 s, < 70 % silence) and crowd-validated afterward.
- Prompts are ~15-word text chunks â†’ training utterances are short, matching the live-captioning inference pattern of 5â€“15 s audio windows. This train/inference distribution match is a deliberate asset; keep prompt chunking policy stable on the crowdsource side.
- Music corpora (ABC notation) also export; they are **out of scope** here (possible future input to `lcyt-music`).

**Dataset snapshots:** every training run consumes an immutable snapshot â€” the export CSV + audio files copied at a point in time, content-hashed and given a snapshot id. Model artifacts record their snapshot id (see Phase 3), so any model is reproducible and auditable.

### Data protection note

Voice recordings are personal data, and a congregation-context corpus can imply religious affiliation (GDPR special category). The crowdsource platform already handles the hard part at the right layer: explicit recording consent before contribution, ToS covering research-dataset release and post-release irrevocability, anonymize-or-delete account options. This plan adds only two obligations on the LCYT side: (1) training consumes **only** the consented, validated export; (2) each released model version records which dataset snapshot it was trained on. Raw snapshot storage lives on infrastructure the project controls (see Phase 2), not third-party ML platforms.

---

## Architecture Overview

```
â”Œâ”€ crowd-source-voice (separate repo/deployment) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  contributors record â†’ crowd validates â†’ admin export API  â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                       â”‚ snapshot pull (Phase 2)
                       â–¼
â”Œâ”€ python-packages/auditor_stt (liturgos-auditor repo) â”€â”€â”€â”€â”€â”€â”€â”
â”‚  dataset/   snapshot â†’ HF dataset, train/dev/test split    â”‚
â”‚  train/     fine-tune (full | LoRA) â†’ HF checkpoint        â”‚
â”‚  convert/   HF checkpoint â†’ CTranslate2 (+ int8)           â”‚
â”‚  eval/      WER/CER vs. held-out + real-service eval set   â”‚
â”‚  serve/     FastAPI + faster-whisper inference server      â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                       â”‚ versioned model artifact (Phase 3)
                       â–¼
â”Œâ”€ liturgos-auditor service (docker image, compose) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  GET  /health            model id, device, load status     â”‚
â”‚  POST /inference         whisper.cpp-compatible multipart  â”‚
â”‚  POST /v1/audio/transcriptions  OpenAI-compatible endpoint â”‚
â”‚  GET/POST /model         list / switch model versions      â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                       â”‚ WHISPER_HTTP_URL=http://auditor-stt:8090
                       â”‚ or
                       â”‚ OPENAI_STT_URL=http://auditor-stt:8090
                       â–¼
â”Œâ”€ existing LCYT pipeline (with HLS init segment fix) â”€â”€â”€â”€â”€â”€â”€â”
â”‚  HlsSegmentFetcher â”€â”€â” (fetches #EXT-X-MAP init segments)  â”‚
â”‚      â”‚ (prepends init data to media segments)              â”‚
â”‚      â–¼               â”‚                                       â”‚
â”‚  SttManager â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â†’ WhisperHttpAdapter / OpenAiAdapterâ”‚
â”‚    â”‚                     â†’ transcript â†’ translation â†’ etc   â”‚
â”‚    â””â”€â†’ transcript event â†’ caption fan-out â†’ YouTube        â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

The integration seam is the whole point: because `WhisperHttpAdapter` and `OpenAiAdapter` already speak the whisper.cpp `/inference` and OpenAI-compatible protocols, **no changes to LCYT's adapters were needed** â€” point `WHISPER_HTTP_URL` or `OPENAI_STT_URL` at the new service and the existing HLS/RTMP/WHEP â†’ transcript â†’ fan-out pipeline just works.

## Critical fix: HLS init segment prepending (discovered Sep 2026)

fMP4 HLS media segments from MediaMTX/ffmpeg are posted to the STT service without init data (the `#EXT-X-MAP` segment). Decoders expect a complete MP4 file with init box (`ftyp`, `moov`). This caused:
- 422 errors ("Could not decode audio") when HLS segments were posted alone
- Adapters failing silently, skipping chunks

**Fix:** `HlsSegmentFetcher` now:
1. Parses `#EXT-X-MAP:URI="..."` from the playlist and fetches the init segment once per distinct URI
2. Caches the init buffer and prepends it to every media segment before sending to the adapter
3. On init fetch failure: emits error, skips that poll's segments (transient caption loss), and retries the init fetch on the next poll (recovers when fetch succeeds)
4. Supports byte-range requests (`BYTERANGE="len@off"`)

Result: Fixed the default `audioSource: 'hls'` path for both `WhisperHttpAdapter` and `OpenAiAdapter`. No init â†’ 422 errors are now prevented by init prepending. Transient init failures (network, service restart) tolerate segment loss on failure polls, with recovery on next successful fetch.

---

## Phase 1 â€” Inference service MVP (IMPLEMENTED in `liturgos-auditor`)

The standalone service is implemented at `auditor_stt/serve/` in the sibling `liturgos-auditor` repository.

**Server:** FastAPI + uvicorn + faster-whisper.

- `POST /inference` â€” whisper.cpp-compatible: multipart `file` (any ffmpeg-decodable format), optional `language` (short ISO 639-1; default `fi`), optional `model`. Response: `{ "text": "...", "language": "...", "segments": [...] }` â€” LCYT adapters read only top-level `text`.
- `POST /v1/audio/transcriptions` â€” OpenAI-compatible endpoint (supports `file`, `model`, `language`, `response_format`, `prompt`, `temperature`).
- `GET /health` â€” returns 200 when model is loaded, 503 while loading or after failure.
- `GET /status` â€” queue depth, model info, device type.
- Device selection: auto-detects CUDA, falls back to CPU int8. Overridable via `AUDITOR_STT_DEVICE`.
- Bounded queue: rejects with `503 "Inference queue depth exceeded"` when live requests exceed `AUDITOR_STT_MAX_QUEUE` (default 8).
- Env config: `AUDITOR_STT_PORT` (default **8090**), `AUDITOR_STT_MODEL_DIR`, `AUDITOR_STT_MODEL` (default `large-v3-turbo`), `AUDITOR_STT_DEFAULT_LANGUAGE=fi`, `AUDITOR_STT_API_KEY` (optional bearer auth).

**Docker:** two Dockerfiles â€” `Dockerfile` (CPU) and `Dockerfile.cuda`. Model weights download/mount on first boot.

**Compose:** optional service with `WHISPER_HTTP_URL=http://auditor-stt:8090` wired into lcyt-backend.

**Tests:** comprehensive in `liturgos-auditor` repo (pytest).

**Verification:** **NOT YET COMPLETED** â€” end-to-end test against a live LCYT stack (RTMP ingest â†’ `POST /stt/start` with provider `whisper_http` â†’ captions arrive) has not been run. This is a blocking item for production deployment.

---

## Phase 2 â€” Dataset pipeline

`lcyt_stt/dataset/` â€” turns crowdsource exports into immutable training snapshots.

- `lcyt-stt dataset pull --base-url â€¦ --corpus-id â€¦ --out snapshots/<date>/` â€” authenticates against crowd-source-voice (admin JWT via env), downloads the validated CSV export + manifest, copies audio files (manifest-driven; supports both API download and direct-filesystem copy for a co-hosted deployment), verifies durations, and writes `snapshot.json`: created-at, corpus ids, recording count, total hours, content hash. Snapshots are append-only.
- `lcyt-stt dataset build --snapshot â€¦ --out â€¦` â€” converts a snapshot to a Hugging Face `datasets` audio dataset with a deterministic, seeded **speaker-disjoint** train/dev/test split (split by anonymized contributor id, not by utterance). **Implemented 2026-07-26:** crowd-source-voice gained a `speaker_id` field for exactly this (`server/utils/speakerId.js`, a salted double-SHA-256 hash of the contributor's email â€” never the email itself, `null` once an account is anonymized/deleted), added to both `GET /api/export` (`format=json`) and `GET /api/export/manifest` rows. `lcyt_stt/dataset/build.py`'s `compute_split()` uses it when every row in a snapshot has one; if a snapshot predates the field (or a row's contributor was anonymized), it falls back to a seeded random utterance-level split and records `speaker_disjoint: false` in the build metadata rather than silently claiming a disjoint split it didn't actually do. Text normalization: lowercase-free (Whisper is cased), strip prompt artifacts, NFC-normalize; keep Finnish orthography untouched (`lcyt_stt/dataset/normalize.py`).
- Storage: snapshots live on project-controlled storage (local disk or the project's S3 bucket â€” same bucket family `lcyt-files` already uses; plain `aws s3 sync` is sufficient, no adapter code needed).

---

## Phase 3 â€” Training pipeline

`lcyt_stt/train/` â€” hardware-agnostic (any CUDA box: rented cloud instance or own hardware; provisioning deliberately unscoped per the planning decision).

- Single entry point `lcyt-stt train --config configs/fi-turbo-full.yaml`. Config declares: base model, snapshot path, full-vs-LoRA, epochs, LR schedule, batch/grad-accum (tuned by available VRAM), SpecAugment, eval cadence. Plain `transformers` `Seq2SeqTrainer` + `peft` for the LoRA path â€” no proprietary trainer, no cloud-vendor SDK.
- Checkpointing + resume (spot-instance friendly). Dev-set WER evaluated during training; best checkpoint kept.
- `lcyt-stt convert --checkpoint â€¦ --out â€¦` â€” HF checkpoint â†’ CTranslate2 via `ct2-transformers-converter`, producing both `float16` and `int8` variants.
- Output is a **versioned model artifact**: `models/lcyt-fi-<semver>/` containing the CT2 model, tokenizer files, and `model.json` (base model, snapshot id + hash, training config, final dev/test WER/CER, created-at). Artifacts upload to the same S3 area as snapshots; the inference service's `LCYT_STT_MODEL_DIR` is populated from there.

**VRAM guidance (documented in the package README, not enforced):** full fine-tune of turbo fits in ~24 GB with bf16 + grad checkpointing; LoRA fits in ~10 GB. Neither requires multi-GPU at this dataset scale.

---

## Phase 4 â€” Evaluation harness & promotion gate

`lcyt_stt/eval/` â€” no model ships on vibes.

- **Held-out test set** from the snapshot split (speaker-disjoint) â€” measures crowdsource-domain quality.
- **Real-service eval set** â€” the metric that actually matters: 30â€“60 min of genuine service recordings (spontaneous speech, room mic, one speaker) with hand-corrected transcripts, stored as a small fixed corpus alongside snapshots. Crowdsourced *read* speech differs from *spontaneous sermon* speech; without this set we'd optimize the wrong thing. Building it is a one-time manual task (LCYT's own caption archive is a good starting point for draft transcripts to correct).
- `lcyt-stt eval --model â€¦ --sets heldout,service` â†’ WER/CER per set (Finnish-aware normalization before scoring: case-fold, strip punctuation, normalize compound hyphens), plus RTF on the eval host. Results append to the artifact's `model.json`.
- **Promotion rule:** a new model version becomes the service default only if it beats the currently deployed version on the real-service set and does not regress > 1 % absolute WER on held-out. Otherwise it stays available but non-default.
- If stock `large-v3-turbo` already meets need on the service set (unlikely for Finnish domain vocabulary, but measure first), fine-tuning effort can be re-prioritized â€” the eval harness is deliberately built **before** the first training run consumes GPU money.

---

## Phase 5 â€” Model management & LCYT integration polish

- Service `GET /model` (list local model versions + active) and `POST /model` (switch active model; loads new, swaps atomically, unloads old). Restart-free model upgrades.
- `lcyt-rtmp` additions (small, optional):
  - Provider alias `lcyt` in STT config resolving to `WhisperHttpAdapter` with `LCYT_STT_URL` as the server URL â€” purely cosmetic/UX so operators see "LCYT (oma)" rather than configuring a generic whisper URL.
  - Setup Hub STT card surfaces the service's `/health` (model version, device) when the alias is configured.
- Ops: runbook in `ops/runbooks/` (deploying the service, installing a new model version, rollback = `POST /model` back), `PORTS.md` entry, `.env.example` entries.
- Future orchestrator note (not built now): the worker-daemon/orchestrator layer could schedule STT on GPU workers; out of scope until a real multi-tenant load exists.

---

## Explicit non-goals / future work

- **Streaming partial transcripts** â€” the current chunked-final model already fits the latency budget; revisit only if sub-chunk latency is ever needed.
- **Distillation** (large-v3 teacher â†’ smaller student) â€” worthwhile once the dataset passes ~300 h and the full-tune quality is known.
- **Training-run provisioning/automation** (cloud GPU rental scripting, orchestrator training jobs) â€” deliberately deferred per planning decision.
- **Music corpora** â€” the crowdsource platform's ABC-notation corpora are a possible future input to `lcyt-music`, not this plan.
- **Modifying crowd-source-voice** â€” except for requesting the anonymous speaker id in the export (Phase 2), the platform is treated as an external data source.
- **Mixing real-condition (service-recording) data into training** â€” likely the biggest quality lever after v1, but it needs its own consent/data-handling decision since service recordings are not covered by the crowdsource consent flow.

## Implementation Status

- [x] **Phase 1** â€” inference service MVP (FastAPI + faster-whisper, `/inference` + `/health` + `/v1/audio/transcriptions`, CPU/CUDA images, compose wiring)
  - [x] WhisperHttpAdapter integration path tested
  - [ ] End-to-end test against live LCYT stack (BLOCKING for production)
  - [x] HLS init segment fix in lcyt-rtmp to support media-segment-only uploads (fMP4 segments now prepended with init data)
- [x] **Phase 2** â€” dataset pipeline (snapshot pull/build, speaker-disjoint split) â€” in `liturgos-auditor`
- [x] **Phase 3** â€” training pipeline (config-driven fine-tune, CT2 conversion, versioned artifacts) â€” in `liturgos-auditor`
- [x] **Phase 4** â€” eval harness (held-out + real-service sets, promotion gate) â€” in `liturgos-auditor`
- [ ] **Phase 5** â€” model management endpoints, `lcyt` provider alias, Setup Hub health surfacing, runbook
  - [x] STT entry in `PORTS.md` (port 8090)
  - [x] Ops runbook `ops/runbooks/stt.md`
- [x] **Retirement** â€” `python-packages/lcyt-stt/` and `docker/lcyt-stt/` removed on `chore/retire-lcyt-stt`; the maintained implementation lives in the sibling `liturgos-auditor` repo (see the note at the top of this document)

