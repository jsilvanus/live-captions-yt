FROM node:20-slim

WORKDIR /app

# Copy root workspace manifest and lockfile
COPY package.json package-lock.json ./

# Copy workspace package manifests (needed for npm ci workspace resolution)
COPY packages/lcyt/package.json packages/lcyt/
COPY packages/lcyt-mcp/package.json packages/lcyt-mcp/

# Install only the two workspace packages
RUN npm ci --workspace=packages/lcyt --workspace=packages/lcyt-mcp --ignore-scripts

# Copy source
COPY packages/lcyt/src/ packages/lcyt/src/
COPY packages/lcyt-mcp/src/ packages/lcyt-mcp/src/

ENV NODE_ENV=production

# stdio MCP server — no port to expose
CMD ["node", "packages/lcyt-mcp/src/server.js"]
