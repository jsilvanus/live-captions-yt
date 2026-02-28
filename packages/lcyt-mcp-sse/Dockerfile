FROM node:20-slim

WORKDIR /app

# Copy root workspace manifest and lockfile
COPY package.json package-lock.json ./

# Copy workspace package manifests (needed for npm ci workspace resolution)
COPY packages/lcyt/package.json packages/lcyt/
COPY packages/lcyt-mcp-sse/package.json packages/lcyt-mcp-sse/

# Install only the two workspace packages
RUN npm ci --workspace=packages/lcyt --workspace=packages/lcyt-mcp-sse --ignore-scripts

# Copy source
COPY packages/lcyt/src/ packages/lcyt/src/
COPY packages/lcyt-mcp-sse/src/ packages/lcyt-mcp-sse/src/

ENV NODE_ENV=production

EXPOSE 3001

CMD ["node", "packages/lcyt-mcp-sse/src/server.js"]
