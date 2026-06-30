FROM node:20-slim AS build
WORKDIR /app

# Copy root workspace manifest and lockfile
COPY package.json package-lock.json ./

# Copy workspace package manifests (needed for npm ci workspace resolution)
COPY packages/lcyt/package.json packages/lcyt/
COPY packages/lcyt-mcp-http/package.json packages/lcyt-mcp-http/
COPY packages/lcyt-backend/package.json packages/lcyt-backend/

# Install workspace packages (includes better-sqlite3 native compilation)
RUN npm ci \
  --workspace=packages/lcyt \
  --workspace=packages/lcyt-mcp-http \
  --workspace=packages/lcyt-backend

# Copy source
COPY packages/lcyt/src/ packages/lcyt/src/
COPY packages/lcyt-mcp-http/src/ packages/lcyt-mcp-http/src/
COPY packages/lcyt-backend/src/ packages/lcyt-backend/src/

FROM node:20-slim
WORKDIR /app
COPY --from=build /app .
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "packages/lcyt-mcp-http/src/server.js"]
