FFmpeg runners
================

This folder contains pluggable FFmpeg runner implementations used by the backend.

Files
- `index.js` — factory `createFfmpegRunner({ runner, ...opts })` which selects the runner implementation based on `FFMPEG_RUNNER` and passed options.
- `local-runner.js` — spawns a local `ffmpeg` child process. Supports setting `stdin` mode (`pipe` or `ignore`), robust `stop()` that waits for process close, and emits `error`/`close` events.
- `docker-runner.js` — runs `ffmpeg` inside Docker. When `TEST_DOCKER=1` the runner will attempt to build a small helper image if the named image does not exist.
- `pipe-utils.js` — helpers for creating/checking FIFOs (POSIX) and a Windows fallback. `makeFifo()` returns a Promise.

Usage notes
- Managers should call `createFfmpegRunner({ runner: 'spawn'|'docker'|'local', cmd: 'ffmpeg', args, name, stdin })` and then `runner.start()`.
- For processes that do not require stdin (most HLS/preview/radio cases) pass `stdin: 'ignore'` to avoid reserving a pipe.
- FIFO-based stdin (for RTMP CEA-708 caption injection) is gated behind `FFMPEG_USE_FIFO=1`. It is disabled by default.

Testing
- Non-Docker unit tests should continue to work unchanged because the default runner remains spawn/local behavior.
- To test Docker behavior locally set `TEST_DOCKER=1` and ensure Docker is available. The runner will attempt to build an image named by `FFMPEG_IMAGE` or the default `lcyt-ffmpeg:latest`.

Safety
- Default runtime behavior is unchanged; no runtime flags are enabled by default.
