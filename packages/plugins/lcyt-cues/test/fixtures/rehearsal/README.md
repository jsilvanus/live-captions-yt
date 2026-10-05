# Rehearsal caption transcripts

Real caption text from a Finnish Lutheran mass, for benchmarking the rolling-window semantic cue matching.

- `messu-2026-09-27.youtube-auto.json` / `.txt`: Riihimäen seurakunta, "Messu su 27.9.2026 klo 10" (YouTube `73zWKvjmv1Q`, 4:12 to 1:19:49). YouTube auto-generated captions copied by hand from the transcript panel; word errors are expected. `text` has the `[musiikkia]` and `[laulu]` tags removed, `raw` keeps them, `music` flags cues that had one. `end` is the next cue's start (last cue +5 s).

Temporary: kept in the repo for now, may move out once the benchmark has a permanent home.
