# lcyt-stt — CPU inference image
#
# faster-whisper (CTranslate2) inference server for LCYT's self-hosted STT
# (docs/plans/plan_local_stt.md). No CUDA runtime — LCYT_STT_DEVICE=cpu is
# set explicitly so ModelHost doesn't waste startup time probing for a GPU
# that this image can never have; use Dockerfile.cuda for GPU inference.
#
# Model weights are NOT baked into the image — they download into
# LCYT_STT_MODEL_DIR (mount a volume there) on first boot.

FROM python:3.12-slim

ARG DEBIAN_FRONTEND=noninteractive

RUN set -eux \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
       ffmpeg \
       ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml README.md ./
COPY lcyt_stt ./lcyt_stt
RUN pip install --no-cache-dir .

ENV LCYT_STT_PORT=8090 \
    LCYT_STT_DEVICE=cpu \
    LCYT_STT_DEFAULT_LANGUAGE=fi

EXPOSE 8090

CMD ["lcyt-stt", "serve"]

# Build (local dev, from repo root — build context is the package source,
# not this docker/ directory):
#   docker build -t lcyt-stt:local -f docker/lcyt-stt/Dockerfile python-packages/lcyt-stt
# Run:
#   docker run --rm -p 8090:8090 -v lcyt-stt-models:/models \
#     -e LCYT_STT_MODEL_DIR=/models lcyt-stt:local
# Verify:
#   curl http://localhost:8090/health
