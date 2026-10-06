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
# Install the shared dependencies first: with no package.json here, `npm install` prunes everything in node_modules
# that it did not install itself, so the executor packages are copied in afterwards.
# onnxruntime-node downloads its native library while installing, so the build needs network access.
RUN npm install --no-save --no-audit --no-fund onnxruntime-node@^1.30.0 playwright-core@^1.51
COPY packages/lcyt-compute/ /opt/lcyt/node_modules/lcyt-compute/
COPY packages/plugins/lcyt-dsk/ /opt/lcyt/node_modules/lcyt-dsk/
RUN cd node_modules/lcyt-compute && npm install --omit=dev --no-audit --no-fund

ARG PERCEPTION_MODEL_URL=https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_tiny.onnx
ARG PERCEPTION_MODEL_SHA256=427cc366d34e27ff7a03e2899b5e3671425c262ea2291f88bb942bc1cc70b0f7
RUN mkdir -p /models \
  && curl -fsSL "$PERCEPTION_MODEL_URL" -o /models/model.onnx \
  && if [ -n "$PERCEPTION_MODEL_SHA256" ]; then echo "$PERCEPTION_MODEL_SHA256  /models/model.onnx" | sha256sum -c -; fi

# The worker imports the executors from /app (ESM ignores NODE_PATH), so link them in. The links resolve to
# /opt/lcyt, where the executors' own dependencies (onnxruntime-node, playwright-core) are installed.
RUN ln -s /opt/lcyt/node_modules/lcyt-compute /app/node_modules/lcyt-compute \
  && ln -s /opt/lcyt/node_modules/lcyt-dsk /app/node_modules/lcyt-dsk

# Fail the build, not the container, when an executor does not resolve from the worker's own location.
RUN cd /app/packages/fffleet-worker/bin \
  && node --input-type=module -e "import.meta.resolve('lcyt-compute/perception/fffleet-executor'); import.meta.resolve('lcyt-dsk/fffleet-executor');" \
  && test -f /opt/lcyt/node_modules/lcyt-compute/src/perception/fffleet-executor.js

# The base image starts `node packages/fffleet-worker/bin/fffleet-worker.js` relative to its working directory.
WORKDIR /app
ENV NODE_PATH=/opt/lcyt/node_modules \
    FFFLEET_EXECUTORS=lcyt-compute/perception/fffleet-executor,lcyt-dsk/fffleet-executor \
    PERCEPTION_MODEL_PATH=/models/model.onnx \
    PERCEPTION_INPUT_SIZE=416 \
    PLAYWRIGHT_DSK_CHROMIUM=/usr/bin/chromium
USER node
