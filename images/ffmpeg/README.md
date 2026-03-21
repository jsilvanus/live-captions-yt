# lcyt ffmpeg image

This folder contains the `Dockerfile` used to build a small Debian-slim image with `ffmpeg` and commonly-used codecs (H.264, MP3, Opus, VP9).

Build:

```bash
docker build -t lcyt-ffmpeg:latest -f docker/ffmpeg/Dockerfile docker/ffmpeg
```

Quick run (prints ffmpeg version):

```bash
docker run --rm lcyt-ffmpeg:latest -version
```

Notes:
- The image exposes `ffmpeg` as the container ENTRYPOINT so the container can be used like a CLI.
- If you require additional codecs (libfdk-aac, nvenc, etc.) build variants or a vendor static build are recommended.
