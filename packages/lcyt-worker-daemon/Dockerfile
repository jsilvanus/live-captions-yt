FROM node:20-slim AS build
WORKDIR /app

# Install dependencies first for layer caching
COPY package.json ./
RUN npm install --omit=dev

COPY src/ src/

# ── Runtime image ──────────────────────────────────────────────────────────────
FROM node:20-slim
WORKDIR /app

# Install Docker CLI so the daemon can launch ephemeral lcyt-ffmpeg containers
# via the Docker socket mounted at /var/run/docker.sock at runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends docker.io \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app .

ENV NODE_ENV=production
ENV PORT=5000

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const http=require('http');const req=http.get('http://127.0.0.1:5000/health',res=>{process.exit(res.statusCode===200?0:1)});req.on('error',()=>process.exit(1));"

CMD ["node", "src/index.js"]
