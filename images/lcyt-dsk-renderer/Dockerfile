FROM node:20-bullseye-slim

# Minimal image: Node, Playwright deps and ffmpeg
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates wget libnss3 libatk1.0-0 libatk-bridge2.0-0 libx11-xcb1 libgtk-3-0 libxss1 libasound2 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/lcyt-dsk-renderer
COPY package.json package-lock.json* ./
RUN npm ci --only=production || true

COPY . .

CMD ["node", "src/renderer.js"]
