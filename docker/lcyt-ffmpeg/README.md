# lcyt-ffmpeg

Debian-slim image with ffmpeg **built from source** (multi-stage — the
compile toolchain doesn't end up in the final image). Used by the lcyt
backend when `FFMPEG_RUNNER=docker` is set, and by the worker daemon for
compute jobs.

Built from source rather than `apt-get install ffmpeg` so the binary
includes the `zmq` filter (`--enable-libzmq`) — required for live, gapless
vertical-crop repositioning (`docs/plans/plan_vertical_crop.md`, Phase 5).
Neither Debian's nor Ubuntu's official ffmpeg packages ship with libzmq
compiled in, so this is the only way to get `hasZmq: true` /
`repositionMode: 'live'` in a containerised deployment — without it,
`CropManager` falls back to restart-mode repositioning (a visible splice on
every crop position change) instead of failing outright.

Build:

```bash
docker build -t lcyt-ffmpeg:latest docker/lcyt-ffmpeg
```

Quick run (prints ffmpeg version):

```bash
docker run --rm lcyt-ffmpeg:latest ffmpeg -version
```

Verify the zmq filter compiled in:

```bash
docker run --rm lcyt-ffmpeg:latest ffmpeg -hide_banner -filters | grep zmq
```
