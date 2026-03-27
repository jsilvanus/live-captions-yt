# lcyt-ffmpeg

Minimal Debian-slim image with ffmpeg installed via apt. Used by the lcyt
backend when `FFMPEG_RUNNER=docker` is set, and by the worker daemon for
compute jobs.

Build:

```bash
docker build -t lcyt-ffmpeg:latest docker/lcyt-ffmpeg
```

Quick run (prints ffmpeg version):

```bash
docker run --rm lcyt-ffmpeg:latest ffmpeg -version
```
