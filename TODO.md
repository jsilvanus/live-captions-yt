# TODO

## Embedding and context quality

- [ ] **Improve semantic-cue embedding context.** The current `cue[semantic]` path embeds only the current caption/text segment for semantic matching, rather than a configurable rolling transcript context window. Investigate a larger context window so semantic matching can use the surrounding speech when a single caption line is ambiguous.
- [ ] **Review embedding vector size.** The current default embedding model is `text-embedding-3-small` (1536 dimensions by default). Evaluate whether a larger or otherwise more suitable embedding model/vector dimensionality would materially improve semantic cue matching, especially for paraphrases and short STT fragments. Document the measured quality/cost/latency trade-off before changing the default.
- [ ] **Make semantic-cue context size configurable.** Define an appropriate rolling window (for example, recent caption lines or a token/character budget), measure precision/recall and latency against the current one-segment baseline, and avoid sending unnecessary transcript data to an external embedding provider.
- [ ] **Test embedding + context combinations.** Benchmark the current single-segment/1536-dimensional baseline against larger context windows and alternative embedding dimensions/models using representative live-caption/STT examples.

## Other unfinished work found in the repo audit

- [ ] **Generalize cue-to-production action execution.** Build a real backend action-dispatch layer so a fired cue can safely invoke production atoms (for example camera, mixer, or crop actions), rather than relying on descriptive cue metadata or client-side interpretation.
- [ ] **Real computer-vision perception: built, not yet proven.** All phases of `docs/plans/plan_perception_completion.md` are implemented (detector, tracker, attribution, reliability, LLM hand-off, crop auto-follow, status panel). Still to do: build and run the worker image with native `onnxruntime-node`, try it on real service footage and a real fleet (tune tracker, framing and visual-match thresholds), Describer text into World State per camera, a frame upload path and `FrameProvider` if the preview-JPEG lag matters.
- [ ] **Complete the `deer` AI provider/runtime.** The provider registry has the provider kind, but the actual runtime path remains unimplemented.
- [x] ~~Wire the remaining vision/camera settings~~ Checked 2026-10-05: all three are wired (`VISION_PREVIEW_BASE_URL` via `ai.vision_preview_base_url` in `VisionRoleManager`, `CAMERA_PREVIEW_BASE_URL` via `production.camera_preview_base_url` in `createProductionRouter`, `CAMERA_THUMBNAILS_DIR` is env-only by design and read by `camera-thumbnail.js`).
- [ ] **Resolve Asset Control Assistant UI ownership.** Provide a real UI/dialog for the DSK image-asset operations exposed to the Asset Control Assistant, or move those operations to the page that owns the corresponding media library.
- [x] ~~**Complete cue-driven vertical-crop actions.**~~ Done in #310 (`crop:` atom, server-side action executor). The vertical-crop production-follow/tooling is substantially implemented, but the named-action/cue-rule path still needs an authoritative execution mechanism.
- [ ] **Finish workflow presets.** Add named, reusable local configuration/workflow bundles in the UI.
- [ ] **Continue orchestration/worker productization.** The worker/orchestration infrastructure is functional, but the broader compute/production surface remains an evolving area and should be audited as features are added.

## Existing

- [ ] Timestamp parsing relies on ISO strings without trailing `Z` — behavior is consistent across Node versions but keep tests for edge cases.
