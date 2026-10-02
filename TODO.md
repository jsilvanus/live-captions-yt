# TODO

## Embedding and context quality

- [ ] **Improve semantic-cue embedding context.** The current `cue[semantic]` path embeds only the current caption/text segment for semantic matching, rather than a configurable rolling transcript context window. Investigate a larger context window so semantic matching can use the surrounding speech when a single caption line is ambiguous.
- [ ] **Review embedding vector size.** The current default embedding model is `text-embedding-3-small` (1536 dimensions by default). Evaluate whether a larger or otherwise more suitable embedding model/vector dimensionality would materially improve semantic cue matching, especially for paraphrases and short STT fragments. Document the measured quality/cost/latency trade-off before changing the default.
- [ ] **Make semantic-cue context size configurable.** Define an appropriate rolling window (for example, recent caption lines or a token/character budget), measure precision/recall and latency against the current one-segment baseline, and avoid sending unnecessary transcript data to an external embedding provider.
- [ ] **Test embedding + context combinations.** Benchmark the current single-segment/1536-dimensional baseline against larger context windows and alternative embedding dimensions/models using representative live-caption/STT examples.

## Other unfinished work found in the repo audit

- [ ] **Generalize cue-to-production action execution.** Build a real backend action-dispatch layer so a fired cue can safely invoke production atoms (for example camera, mixer, or crop actions), rather than relying on descriptive cue metadata or client-side interpretation.
- [ ] **Implement real computer-vision perception.** The vision-role architecture is in place, but the worker-side perception path still needs a real CV/model-backed detector instead of the deterministic/stub detector.
- [ ] **Complete the `deer` AI provider/runtime.** The provider registry has the provider kind, but the actual runtime path remains unimplemented.
- [ ] **Wire the remaining vision/camera settings.** Complete the call-site integration for `VISION_PREVIEW_BASE_URL`, `CAMERA_PREVIEW_BASE_URL`, and `CAMERA_THUMBNAILS_DIR` where they are registered but not yet fully wired.
- [ ] **Resolve Asset Control Assistant UI ownership.** Provide a real UI/dialog for the DSK image-asset operations exposed to the Asset Control Assistant, or move those operations to the page that owns the corresponding media library.
- [ ] **Complete cue-driven vertical-crop actions.** The vertical-crop production-follow/tooling is substantially implemented, but the named-action/cue-rule path still needs an authoritative execution mechanism.
- [ ] **Finish workflow presets.** Add named, reusable local configuration/workflow bundles in the UI.
- [ ] **Continue orchestration/worker productization.** The worker/orchestration infrastructure is functional, but the broader compute/production surface remains an evolving area and should be audited as features are added.

## Existing

- [ ] Timestamp parsing relies on ISO strings without trailing `Z` — behavior is consistent across Node versions but keep tests for edge cases.
