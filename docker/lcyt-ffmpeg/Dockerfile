# lcyt-ffmpeg
# ffmpeg runner image used by the lcyt backend when `FFMPEG_RUNNER=docker` is
# set.
#
# Built from source (rather than the distro `ffmpeg` package) to pin the ffmpeg
# version and a small, known feature set (libx264 + ffmpeg's native filters).
# Live crop repositioning no longer needs a special build: CropManager sends
# `Ccrop@vcrop -1 x <px>` to ffmpeg's stdin (docs/plans/plan_vertical_crop.md,
# "Addendum 2026-10"), which works on any ffmpeg. libzmq was dropped.
#
# Multi-stage: the builder stage compiles ffmpeg; the final stage only ships
# the runtime shared libraries + the built binaries, keeping the image small.

FROM debian:bookworm-slim AS builder

ARG DEBIAN_FRONTEND=noninteractive
ARG FFMPEG_VERSION=6.1.2

RUN set -eux \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
       build-essential pkg-config yasm nasm \
       ca-certificates curl xz-utils \
       libx264-dev \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src
RUN curl -fsSLO "https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz" \
  && tar xf "ffmpeg-${FFMPEG_VERSION}.tar.xz"

WORKDIR /usr/src/ffmpeg-${FFMPEG_VERSION}
# --enable-gpl + --enable-libx264: H.264 encode, used by the CEA-708 embedded
#   caption path and the vertical-crop renderer (both `rtmp-manager.js` and
#   `crop-manager.js` invoke `-c:v libx264`) — the same encoder the previous
#   apt-installed build provided (libx264 has shipped in Debian's "main"
#   component, not just contrib/non-free, since patents on the format
#   expired), so this is capability parity, not an addition.
# Everything else is left at ffmpeg's own defaults: the native muxers/
#   demuxers/encoders this backend also probes for (probeFfmpeg()'s
#   hasEia608/hasSubrip checks) are built in without any extra --enable flag,
#   and every ffmpeg invocation in this codebase targets a local (127.0.0.1)
#   MediaMTX endpoint only (rtsp/rtmp, never https), so TLS-capable network
#   protocols (--enable-gnutls/--enable-openssl) are intentionally left out —
#   add one if a future use case needs ffmpeg to reach an external https
#   source directly.
RUN ./configure \
      --prefix=/usr/local \
      --enable-shared \
      --disable-static \
      --disable-doc \
      --disable-debug \
      --enable-gpl \
      --enable-libx264 \
  && make -j"$(nproc)" \
  && make install \
  && ldconfig

FROM debian:bookworm-slim

ARG DEBIAN_FRONTEND=noninteractive
ENV LCYT_FFMPEG_VERSION=6.1.2

RUN set -eux \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
       ca-certificates \
       dumb-init \
       procps \
       libx264-164 \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/local/bin/ffmpeg /usr/local/bin/ffprobe /usr/local/bin/
COPY --from=builder /usr/local/lib/ /usr/local/lib/
RUN ldconfig
ENV PATH="/usr/local/bin:${PATH}"

# lightweight, predictable entrypoint; the backend typically runs ffmpeg
# by invoking `docker run ... lcyt-ffmpeg ...` or using the image as a base
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["ffmpeg", "-version"]

# Build (local dev):
#   docker build -t lcyt-ffmpeg:local ./docker/lcyt-ffmpeg
# Verify libx264 is compiled in (should print a line containing "libx264"):
#   docker run --rm lcyt-ffmpeg:local ffmpeg -hide_banner -encoders | grep libx264
# Example registry tag & push:
#   docker tag lcyt-ffmpeg:local registry.example.com/org/lcyt-ffmpeg:1.0.0
#   docker push registry.example.com/org/lcyt-ffmpeg:1.0.0
