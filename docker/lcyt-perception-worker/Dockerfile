# lcyt-perception-worker: an fffleet worker that runs LCYT perception jobs (person detection on camera
# streams). It is the stock fffleet worker plus ffmpeg, onnxruntime-node, a YOLOX model and the
# `lcyt-compute` perception executor, which makes the worker claim the `type:perception` job type
# (docs/plans/plan_video_perception.md, docs/plans/plan_perception_completion.md).
#
# Build from the repository root so lcyt-compute is in the build context:
#   docker build -f docker/lcyt-perception-worker/Dockerfile -t lcyt-perception-worker .
# Run:
#   docker run -p 5100:5100 -e FFFLEET_TOKEN=secret lcyt-perception-worker
# Point the backend at the fleet with FFFLEET_URL and the stream base with PERCEPTION_STREAM_BASE_URL
# (the worker must be able to reach that address, e.g. rtsp://mediamtx:8554).
#
# The model is Apache-2.0 YOLOX (Megvii-BaseDetection/YOLOX). To use another one, override
# PERCEPTION_MODEL_URL, PERCEPTION_MODEL_SHA256 and (if its input is not 416) PERCEPTION_INPUT_SIZE.

FROM node:22-bookworm-slim

# onnxruntime-node downloads its native library while installing, so the build needs network access.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY packages/lcyt-compute/ /app/node_modules/lcyt-compute/
RUN cd /app/node_modules/lcyt-compute \
  && npm install --omit=dev --no-audit --no-fund \
  && npm install --no-save --no-audit --no-fund --prefix /app fffleet-worker@^2.0.0 onnxruntime-node@^1.30.0

ARG PERCEPTION_MODEL_URL=https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_tiny.onnx
ARG PERCEPTION_MODEL_SHA256=427cc366d34e27ff7a03e2899b5e3671425c262ea2291f88bb942bc1cc70b0f7
RUN mkdir -p /models \
  && curl -fsSL "$PERCEPTION_MODEL_URL" -o /models/model.onnx \
  && if [ -n "$PERCEPTION_MODEL_SHA256" ]; then echo "$PERCEPTION_MODEL_SHA256  /models/model.onnx" | sha256sum -c -; fi

ENV NODE_ENV=production \
    PORT=5100 \
    FFFLEET_EXECUTORS=lcyt-compute/perception/fffleet-executor \
    PERCEPTION_MODEL_PATH=/models/model.onnx \
    PERCEPTION_INPUT_SIZE=416

EXPOSE 5100
CMD ["node", "/app/node_modules/fffleet-worker/bin/fffleet-worker.js"]
