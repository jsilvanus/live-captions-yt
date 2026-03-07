FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
COPY packages/lcyt/package.json packages/lcyt/
COPY packages/lcyt-backend/package.json packages/lcyt-backend/
RUN npm ci --workspace=packages/lcyt --workspace=packages/lcyt-backend
COPY packages/lcyt/ packages/lcyt/
COPY packages/lcyt-backend/ packages/lcyt-backend/

FROM node:20-slim
WORKDIR /app
COPY --from=build /app .
# Install ffmpeg when RTMP relay is active (build with --build-arg RTMP_RELAY_ACTIVE=1)
ARG RTMP_RELAY_ACTIVE=0
RUN if [ "$RTMP_RELAY_ACTIVE" = "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends ffmpeg \
      && rm -rf /var/lib/apt/lists/*; \
    fi
ENV NODE_ENV=production
ENV RTMP_RELAY_ACTIVE=${RTMP_RELAY_ACTIVE}
# Toggle free-tier API key handout endpoint (0 = disabled, 1 = enabled)
ENV FREE_APIKEY_ACTIVE=0
# Directory for per-key caption/translation files
ENV FILES_DIR=/data/files
# Database backup retention in days (0 = disabled, max 180)
ENV BACKUP_DAYS=0
RUN mkdir -p /data /backups && chown node:node /data /backups
VOLUME ["/backups"]
USER node
# Declare volumes for persistent data and caption files
VOLUME ["/data"]
EXPOSE 3000
# Lightweight healthcheck using Node (avoids adding curl/wget)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD node -e "const http=require('http');const req=http.get('http://127.0.0.1:3000/health',res=>{process.exit(res.statusCode===200?0:1)});req.on('error',()=>process.exit(1));"
CMD ["node", "packages/lcyt-backend/src/index.js"]
