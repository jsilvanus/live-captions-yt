FROM node:20-slim AS build
WORKDIR /app

# Copy workspace manifests (enables layer caching for npm ci)
COPY package.json package-lock.json ./
COPY packages/lcyt/package.json packages/lcyt/
COPY packages/lcyt-backend/package.json packages/lcyt-backend/
COPY packages/lcyt-mcp-sse/package.json packages/lcyt-mcp-sse/
COPY packages/plugins/lcyt-production/package.json packages/plugins/lcyt-production/
COPY packages/plugins/lcyt-dsk/package.json packages/plugins/lcyt-dsk/
COPY packages/plugins/lcyt-rtmp/package.json packages/plugins/lcyt-rtmp/

# Install workspace dependencies.
RUN npm ci \
  --workspace=packages/lcyt \
  --workspace=packages/lcyt-backend \
  --workspace=packages/lcyt-mcp-sse \
  --workspace=packages/plugins/lcyt-production \
  --workspace=packages/plugins/lcyt-dsk \
  --workspace=packages/plugins/lcyt-rtmp

# Copy source
COPY packages/lcyt/ packages/lcyt/
COPY packages/lcyt-backend/ packages/lcyt-backend/
COPY packages/lcyt-mcp-sse/src/ packages/lcyt-mcp-sse/src/
COPY packages/plugins/lcyt-production/ packages/plugins/lcyt-production/
COPY packages/plugins/lcyt-dsk/ packages/plugins/lcyt-dsk/
COPY packages/plugins/lcyt-rtmp/ packages/plugins/lcyt-rtmp/

FROM node:20-slim
WORKDIR /app
COPY --from=build /app .

# Install ffmpeg when any feature that uses it is active:
# RTMP relay, radio HLS, video HLS embed (/stream-hls), or preview thumbnails (/preview).
# (build with --build-arg RTMP_RELAY_ACTIVE=1, RADIO_ACTIVE=1, HLS_ACTIVE=1, or PREVIEW_ACTIVE=1)
ARG RTMP_RELAY_ACTIVE=0
ARG RADIO_ACTIVE=0
ARG HLS_ACTIVE=0
ARG PREVIEW_ACTIVE=0
RUN if [ "$RTMP_RELAY_ACTIVE" = "1" ] || [ "$RADIO_ACTIVE" = "1" ] || [ "$HLS_ACTIVE" = "1" ] || [ "$PREVIEW_ACTIVE" = "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends ffmpeg \
      && rm -rf /var/lib/apt/lists/*; \
    fi

ARG GRAPHICS_ENABLED=0
RUN if [ "$GRAPHICS_ENABLED" = "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends chromium \
      && rm -rf /var/lib/apt/lists/*; \
    fi
ENV PLAYWRIGHT_DSK_CHROMIUM=/usr/bin/chromium

ENV NODE_ENV=production
ENV RTMP_RELAY_ACTIVE=${RTMP_RELAY_ACTIVE}
ENV RADIO_ACTIVE=${RADIO_ACTIVE}
ENV HLS_ACTIVE=${HLS_ACTIVE}
ENV PREVIEW_ACTIVE=${PREVIEW_ACTIVE}

# Copy process manager entrypoint and make executable, create SQLite data dir
COPY scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh \
 && mkdir -p /data \
 && chown node:node /data

# Create a convenience symlink `/app/bin` → backend's bin directory
# so any runtime scripts can be found at `/app/bin` inside the image.
RUN rm -rf /app/bin \
 && ln -s /app/packages/lcyt-backend/bin /app/bin || true

USER node
EXPOSE 3000
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
	CMD node -e "const http=require('http');const req=http.get('http://127.0.0.1:3000/health',res=>{process.exit(res.statusCode===200?0:1)});req.on('error',()=>process.exit(1));"
CMD ["/entrypoint.sh"]
