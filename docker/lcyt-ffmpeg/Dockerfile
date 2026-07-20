# lcyt-ffmpeg
# ffmpeg runner image used by the lcyt backend when `FFMPEG_RUNNER=docker` is
# set.
#
# Built from source (rather than the distro `ffmpeg` package) so the binary
# includes the `zmq` filter (--enable-libzmq) — required for live, gapless
# vertical-crop repositioning (docs/plans/plan_vertical_crop.md, Phase 5).
# Neither Debian's nor Ubuntu's official `ffmpeg` apt packages are built with
# libzmq (verified against packages.debian.org/packages.ubuntu.com — neither
# lists libzmq5 as a runtime dependency), so simply installing the
# `libzmq3-dev` runtime/dev library alongside the distro ffmpeg binary — as
# an earlier revision of the plan suggested — does NOT add the filter: the
# zmq graph node has to be compiled into ffmpeg's own libavfilter, which only
# happens with a `--enable-libzmq` build. Without it, CropManager
# (packages/plugins/lcyt-rtmp/src/crop-manager.js) correctly detects the
# missing filter via probeFfmpeg()'s `hasZmq` check and falls back to
# restart-mode repositioning (a visible splice on every position change)
# instead of failing — but this image should give `repositionMode: 'live'`.
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
       libzmq3-dev libx264-dev \
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
# --enable-libzmq: the `zmq` filter — see header comment above.
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
      --enable-libzmq \
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
       libzmq5 \
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
# Verify the zmq filter compiled in (should print a line containing " zmq "):
#   docker run --rm lcyt-ffmpeg:local ffmpeg -hide_banner -filters | grep zmq
# Example registry tag & push:
#   docker tag lcyt-ffmpeg:local registry.example.com/org/lcyt-ffmpeg:1.0.0
#   docker push registry.example.com/org/lcyt-ffmpeg:1.0.0
