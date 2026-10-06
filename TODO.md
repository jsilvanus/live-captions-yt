# TODO

Open work only. Finished items live in git history and `docs/PLANS.md`; skipped review findings in `CONSIDER.md`. Last reviewed 2026-10-06.

## Verification against real systems (highest priority)

- [ ] **Stack bring-up with real services.** Everything that talks to another machine is tested against fakes only: the fffleet fleet (relay, STT, music, PCM, DSK, perception, crop stdin), the auditor STT service (`STT_PROVIDER=auditor`), MediaMTX, YouTube platform sync/OAuth and local `deer` embeddings. Run one rehearsal with LCYT + MediaMTX + fffleet + auditor.
- [ ] **Perception on real footage.** Build and run `docker/lcyt-perception-worker` with native `onnxruntime-node` on service video and a real fleet; tune tracker, framing and visual-match thresholds. Also open: Describer text into World State per camera, a frame upload path and `FrameProvider` if the preview-JPEG lag matters, and the church-data-protection pass on the perception privacy text.
- [ ] **Crop stdin latency** on a real RTSP/MediaMTX source and that a fleet worker keeps stdin open for stream jobs (see `CONSIDER.md`).

## Product work

- [ ] **Semantic cues: more services.** The default is now 0.70 with once-per-section firing (2026-10-06, from two hand-labelled services). Add more rehearsal transcripts (never with private names), per-cue thresholds, and the rundown metacode syntax for `context_mode`, `context_segments` and `once_per_section`. Re-check embedding model and vector size before changing the default model.
- [ ] **AI provider admin UI.** Admin CRUD routes exist; nothing in `lcyt-web` creates providers (`CONSIDER.md`).
- [ ] **Workflow presets.** Named, reusable local configuration/workflow bundles in the UI.

## Deferred (decided 2026-10-06)

- **Facebook Live adapter** in `lcyt-platforms` (interface skeleton only; Meta App Review is the long pole).
- **`deer` chat provider kind** (`agentic-turn.js` returns `null`); waits for chattydeer. Local `deer` embeddings work.

## Housekeeping

- [ ] Remaining `CONSIDER.md` items (about 15), each small.
- [ ] Python packages are not part of the 2026-10-06 test run; run them with the next release.

## Existing

- [ ] Timestamp parsing relies on ISO strings without trailing `Z` — behavior is consistent across Node versions but keep tests for edge cases.
