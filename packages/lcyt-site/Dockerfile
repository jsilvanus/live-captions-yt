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

ENV NODE_ENV=production
# Toggle free-tier API key handout endpoint (0 = disabled, 1 = enabled)
ENV FREE_APIKEY_ACTIVE=0

# Copy process manager entrypoint and make executable, create SQLite data dir
COPY packages/lcyt-site/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh \
 && mkdir -p /data \
 && chown node:node /data

USER node
EXPOSE 3000
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
	CMD node -e "const http=require('http');const req=http.get('http://127.0.0.1:3000/health',res=>{process.exit(res.statusCode===200?0:1)});req.on('error',()=>process.exit(1));"
CMD ["/entrypoint.sh"]
