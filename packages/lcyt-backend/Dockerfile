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
ENV NODE_ENV=production
# Toggle free-tier API key handout endpoint (0 = disabled, 1 = enabled)
ENV FREE_APIKEY_ACTIVE=0
# Directory for per-key caption/translation files
ENV FILES_DIR=/data/files
RUN mkdir -p /data/files && chown -R node:node /data
USER node
# Declare volumes for persistent data and caption files
VOLUME ["/data"]
EXPOSE 3000
# Lightweight healthcheck using Node (avoids adding curl/wget)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD node -e "const http=require('http');const req=http.get('http://127.0.0.1:3000/health',res=>{process.exit(res.statusCode===200?0:1)});req.on('error',()=>process.exit(1));"
CMD ["node", "packages/lcyt-backend/src/index.js"]
