# lcyt-ffmpeg

Debian-slim image with ffmpeg **built from source** (multi-stage — the
compile toolchain doesn't end up in the final image). Used by the lcyt
backend when `FFMPEG_RUNNER=docker` is set, and by the worker daemon for
compute jobs.

Built from source rather than `apt-get install ffmpeg` to pin the ffmpeg
version and a small feature set (libx264 plus ffmpeg's native filters). Live
vertical-crop repositioning does not need anything special: `CropManager`
sends interactive commands over ffmpeg's stdin (`docs/plans/plan_vertical_crop.md`,
"Addendum 2026-10"). The earlier `--enable-libzmq` build was dropped.

Build:

```bash
docker build -t lcyt-ffmpeg:latest docker/lcyt-ffmpeg
```

Quick run (prints ffmpeg version):

```bash
docker run --rm lcyt-ffmpeg:latest ffmpeg -version
```

Verify libx264 compiled in:

```bash
docker run --rm lcyt-ffmpeg:latest ffmpeg -hide_banner -encoders | grep libx264
```
