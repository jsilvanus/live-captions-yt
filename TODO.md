# TODO

## Embedding and context quality

- [ ] **Improve semantic-cue embedding context.** The current `cue[semantic]` path embeds only the current caption/text segment for semantic matching, rather than a configurable rolling transcript context window. Investigate a larger context window so semantic matching can use the surrounding speech when a single caption line is ambiguous.
- [ ] **Review embedding vector size.** The current default embedding model is `text-embedding-3-small` (1536 dimensions by default). Evaluate whether a larger or otherwise more suitable embedding model/vector dimensionality would materially improve semantic cue matching, especially for paraphrases and short STT fragments. Document the measured quality/cost/latency trade-off before changing the default.
- [ ] **Make semantic-cue context size configurable.** Define an appropriate rolling window (for example, recent caption lines or a token/character budget), measure precision/recall and latency against the current one-segment baseline, and avoid sending unnecessary transcript data to an external embedding provider.
- [ ] **Test embedding + context combinations.** Benchmark the current single-segment/1536-dimensional baseline against larger context windows and alternative embedding dimensions/models using representative live-caption/STT examples.

## Existing

- [ ] Timestamp parsing relies on ISO strings without trailing `Z` — behavior is consistent across Node versions but keep tests for edge cases.
