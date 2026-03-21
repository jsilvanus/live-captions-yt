# lcyt-dsk-renderer image

Minimal Dockerfile for DSK renderer: Node.js + Playwright deps + ffmpeg.

Build:

```bash
docker build -t lcyt-dsk-renderer:latest images/lcyt-dsk-renderer
```

This image is a starting point; production image should pin Playwright and Chromium versions.
