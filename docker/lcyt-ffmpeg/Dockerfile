# lcyt-ffmpeg
# Minimal ffmpeg runner image used by the lcyt backend when
# `FFMPEG_RUNNER=docker` is set. Built for reproducible local dev.

FROM debian:bookworm-slim

ARG DEBIAN_FRONTEND=noninteractive
ENV LCYT_FFMPEG_VERSION=system

RUN set -eux \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
       ca-certificates \
       ffmpeg \
       dumb-init \
       procps \
  && rm -rf /var/lib/apt/lists/*

# lightweight, predictable entrypoint; the backend typically runs ffmpeg
# by invoking `docker run ... lcyt-ffmpeg ...` or using the image as a base
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["ffmpeg", "-version"]

# Build (local dev):
#   docker build -t lcyt-ffmpeg:local ./images/lcyt-ffmpeg
# Example registry tag & push:
#   docker tag lcyt-ffmpeg:local registry.example.com/org/lcyt-ffmpeg:1.0.0
#   docker push registry.example.com/org/lcyt-ffmpeg:1.0.0
