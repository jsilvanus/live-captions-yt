# lcyt-fleet-worker: the one fat fffleet worker for LCYT. The stock fffleet worker (ffmpeg) plus Chromium and the
# `lcyt-dsk` executor (type:dsk), and onnxruntime, a YOLOX model and the `lcyt-compute` perception executor
# (type:perception). Replaces running docker/lcyt-dsk-worker and docker/lcyt-perception-worker separately.
#
# Build from the repository root (lcyt-compute and lcyt-dsk are in the build context):
#   docker build -f docker/lcyt-fleet-worker/Dockerfile -t lcyt-fleet-worker .
# Published by .github/workflows/publish-images.yml as ghcr.io/jsilvanus/lcyt-fleet-worker.
#
# The model is Apache-2.0 YOLOX. Override PERCEPTION_MODEL_URL, PERCEPTION_MODEL_SHA256 and (if its input is not 416)
# PERCEPTION_INPUT_SIZE to use another one.
ARG FFFLEET_VERSION=latest
FROM ghcr.io/jsilvanus/fffleet-worker:${FFFLEET_VERSION}

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/lcyt
COPY packages/lcyt-compute/ /opt/lcyt/node_modules/lcyt-compute/
COPY packages/plugins/lcyt-dsk/ /opt/lcyt/node_modules/lcyt-dsk/
# onnxruntime-node downloads its native library while installing, so the build needs network access.
RUN cd node_modules/lcyt-compute && npm install --omit=dev --no-audit --no-fund \
  && cd /opt/lcyt && npm install --no-save --no-audit --no-fund onnxruntime-node@^1.30.0 playwright-core@^1.51

ARG PERCEPTION_MODEL_URL=https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_tiny.onnx
ARG PERCEPTION_MODEL_SHA256=427cc366d34e27ff7a03e2899b5e3671425c262ea2291f88bb942bc1cc70b0f7
RUN mkdir -p /models \
  && curl -fsSL "$PERCEPTION_MODEL_URL" -o /models/model.onnx \
  && if [ -n "$PERCEPTION_MODEL_SHA256" ]; then echo "$PERCEPTION_MODEL_SHA256  /models/model.onnx" | sha256sum -c -; fi

# The executors resolve from /opt/lcyt/node_modules.
ENV NODE_PATH=/opt/lcyt/node_modules \
    FFFLEET_EXECUTORS=lcyt-compute/perception/fffleet-executor,lcyt-dsk/fffleet-executor \
    PERCEPTION_MODEL_PATH=/models/model.onnx \
    PERCEPTION_INPUT_SIZE=416 \
    PLAYWRIGHT_DSK_CHROMIUM=/usr/bin/chromium
USER node
