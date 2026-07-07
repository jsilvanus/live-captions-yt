# lcyt-bridge — plain Node.js container deployment mode (plan/ai_model_registry).
#
# No pkg, no system tray: packages/lcyt-bridge/src/tray.js is a gracefully
# optional import, so `node src/index.js` runs headless as-is. Configure via
# the same BACKEND_URL / BRIDGE_TOKEN env vars the desktop build reads.
#
# Build from the repo root:
#   docker build -f docker/lcyt-bridge/Dockerfile -t lcyt-bridge .

FROM node:20-slim

WORKDIR /app

# Workspace install: the bridge package + the root manifest for npm workspaces.
COPY package.json package-lock.json ./
COPY packages/lcyt-bridge ./packages/lcyt-bridge

RUN npm ci --omit=dev --workspace=packages/lcyt-bridge

WORKDIR /app/packages/lcyt-bridge

CMD ["node", "src/index.js"]
