FROM node:20-slim AS build
WORKDIR /app

# Copy workspace manifests (enables layer caching for npm ci)
COPY package.json package-lock.json ./
COPY packages/lcyt/package.json packages/lcyt/
COPY packages/lcyt-backend/package.json packages/lcyt-backend/
COPY packages/lcyt-mcp-sse/package.json packages/lcyt-mcp-sse/

# Install workspace dependencies.
RUN npm ci \
  --workspace=packages/lcyt \
  --workspace=packages/lcyt-backend \
  --workspace=packages/lcyt-mcp-sse

# Copy source
COPY packages/lcyt/ packages/lcyt/
COPY packages/lcyt-backend/ packages/lcyt-backend/
COPY packages/lcyt-mcp-sse/src/ packages/lcyt-mcp-sse/src/

FROM node:20-slim
WORKDIR /app
COPY --from=build /app .

# Install ffmpeg when RTMP relay or radio HLS is active
# (build with --build-arg RTMP_RELAY_ACTIVE=1 or --build-arg RADIO_ACTIVE=1)
ARG RTMP_RELAY_ACTIVE=0
ARG RADIO_ACTIVE=0
RUN if [ "$RTMP_RELAY_ACTIVE" = "1" ] || [ "$RADIO_ACTIVE" = "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends ffmpeg \
      && rm -rf /var/lib/apt/lists/*; \
    fi

ENV NODE_ENV=production
ENV RTMP_RELAY_ACTIVE=${RTMP_RELAY_ACTIVE}
ENV RADIO_ACTIVE=${RADIO_ACTIVE}

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
