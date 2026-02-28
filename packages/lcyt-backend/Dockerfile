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
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
# Lightweight healthcheck using Node (avoids adding curl/wget)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD node -e "const http=require('http');const req=http.get('http://127.0.0.1:3000/health',res=>{process.exit(res.statusCode===200?0:1)});req.on('error',()=>process.exit(1));"
CMD ["node", "packages/lcyt-backend/src/index.js"]
