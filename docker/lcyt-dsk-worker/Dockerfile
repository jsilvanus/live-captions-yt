# lcyt-dsk-worker: an fffleet worker that renders DSK graphics streams. It is the stock fffleet worker plus
# Chromium, ffmpeg and the `lcyt-dsk` executor, which makes the worker claim the `type:dsk` job type.
#
# Build from the repository root so lcyt-dsk is in the build context:
#   docker build -f docker/lcyt-dsk-worker/Dockerfile -t lcyt-dsk-worker .
# Run:
#   docker run -p 5100:5100 -e FFFLEET_TOKEN=secret lcyt-dsk-worker
# Point the backend at the fleet with FFFLEET_URL and DSK_RENDER_EXECUTOR=fleet. The worker opens the display
# page at DSK_PAGE_BASE_URL and pushes RTMP to the URLs in the job, so both must be reachable from the worker.

FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg chromium fonts-dejavu-core fontconfig ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY packages/plugins/lcyt-dsk/ /app/node_modules/lcyt-dsk/
# The executor only needs playwright-core (the rest of lcyt-dsk, which needs lcyt-compute, is not loaded).
RUN npm install --no-save --no-audit --no-fund --prefix /app fffleet-worker@^2.0.0 playwright-core@^1.51

ENV NODE_ENV=production \
    PORT=5100 \
    FFFLEET_EXECUTORS=lcyt-dsk/fffleet-executor \
    PLAYWRIGHT_DSK_CHROMIUM=/usr/bin/chromium

EXPOSE 5100
CMD ["node", "/app/node_modules/fffleet-worker/bin/fffleet-worker.js"]
