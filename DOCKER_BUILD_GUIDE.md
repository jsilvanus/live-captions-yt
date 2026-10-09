# Docker Build Guide

This guide covers building and using Docker images for live-captions-yt (LCYT) locally, and troubleshooting registry access issues.

## Local Building

If you encounter rate limiting or access issues with docker.io (Docker Hub), you can build the images locally:

### Build Commands

```bash
# Build the main application image (backend + frontend)
docker build -f Dockerfile -t lcyt:local .

# Build the fleet worker image (includes DSK graphics + perception)
docker build -f docker/lcyt-fleet-worker/Dockerfile -t lcyt-fleet-worker:local .
```

### Tag for Local Use

After building locally, tag the images for use in compose files:

```bash
docker tag lcyt:local ghcr.io/jsilvanus/lcyt:latest
docker tag lcyt-fleet-worker:local ghcr.io/jsilvanus/lcyt-fleet-worker:latest
```

## Using Locally-Built Images

Modify your docker-compose configuration to use the locally-built images:

```yaml
lcyt:
  image: ghcr.io/jsilvanus/lcyt:latest  # Will use local image if not in registry
  # ... rest of config

lcyt-fleet-worker:
  image: ghcr.io/jsilvanus/lcyt-fleet-worker:latest  # Will use local image if not in registry
  # ... rest of config
```

Or use the local tags directly:

```yaml
lcyt:
  image: lcyt:local
  # ... rest of config

lcyt-fleet-worker:
  image: lcyt-fleet-worker:local
  # ... rest of config
```

## Base Image Information

- **Main Application (Dockerfile)**: Uses `node:22-slim` as base
  - Includes: Node.js 22, with optional ffmpeg for local spawn mode
  - Features: Frontend bundle serving from `/srv/web`, optional Playwright DSK graphics support
  - Used for the LCYT backend API and web UI
  
- **Fleet Worker (docker/lcyt-fleet-worker/Dockerfile)**: Built on saarnavideo-worker base
  - Adds: DSK graphics (Chromium), ONNX perception engine
  - Used for DSK graphics rendering and perception tasks in the fffleet system

## Troubleshooting docker.io Access

If you see errors like:
- `Error response from daemon: pull access denied for library/node`
- Rate limit exceeded errors from Docker Hub
- Timeout when pulling images

### Solution 1: Build Locally (Recommended)

Use the local build commands above. This avoids docker.io entirely and works offline (except for npm dependencies).

### Solution 2: Use Authentication

If you have a Docker Hub account:

```bash
docker login
docker pull node:22-slim
```

This provides higher rate limits (200 pulls/hour vs 100 for unauthenticated).

### Solution 3: Configure Docker Daemon

Edit `~/.docker/config.json` or Docker Desktop settings to add registry mirrors or configure authentication.

## CI/CD Publishing

The publish workflow (`.github/workflows/publish-images.yml`) builds and pushes to GitHub Container Registry (ghcr.io), not Docker Hub. The base image is still pulled from docker.io.

For environments with restricted docker.io access:
1. Pre-download the base image and push to a private registry
2. Use the locally-built images in the deployment stack
3. Configure the CI workflow to use an alternative registry for the base image

## Development Build Args

The main Dockerfile supports several build arguments for customizing builds:

- `APT_MIRROR`: Alternative Debian package mirror (e.g., `http://mirror.hetzner.com/debian/packages`)
- `RTMP_RELAY_ACTIVE`: Set to `1` to include ffmpeg for RTMP relay executor
- `RADIO_ACTIVE`: Set to `1` to include ffmpeg for radio mode
- `HLS_ACTIVE`: Set to `1` to include ffmpeg for HLS mode
- `PREVIEW_ACTIVE`: Set to `1` to include ffmpeg for preview generation
- `GRAPHICS_ENABLED`: Set to `1` to enable graphics support

Example:

```bash
docker build -f Dockerfile \
  --build-arg APT_MIRROR=http://mirror.example.com/debian \
  --build-arg RTMP_RELAY_ACTIVE=1 \
  -t lcyt:custom .
```
