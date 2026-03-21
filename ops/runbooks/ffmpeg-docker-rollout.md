# FFMPEG Docker Rollout

This runbook describes how to roll out the Docker-based FFMPEG runner for lcyt.
It assumes you have Docker and Docker Compose installed and are running from
the repository root (`c:\Users\jsilv\Code\live-captions-yt`).

Branch: `director/ffmpeg-phase1-3`

Goals
- Build and register the `lcyt-ffmpeg` image
- Start the `docker-socket-proxy` and `lcyt-ffmpeg` services via `docker-compose`
- Toggle `FFMPEG_RUNNER=docker` for the backend and validate
- Provide exact rollback steps to revert to spawn fallback

Prerequisites
- Docker engine (20+) and Docker Compose (v2+) installed
- If pushing to a registry: credentials configured (docker login)

Files created by this rollout
- `images/lcyt-ffmpeg/Dockerfile`
- `docker-compose.yml` (root)

1) Create branch

```bash
cd C:/Users/jsilv/Code/live-captions-yt
git checkout -b director/ffmpeg-phase1-3
```

2) Build the image locally

Build a local image used by docker-compose:

```bash
docker build -t lcyt-ffmpeg:local ./images/lcyt-ffmpeg
```

3) (Optional) Tag & push to registry

If you have a registry, tag and push the image:

```bash
# replace with your registry path and version
REGISTRY=registry.example.com/org
VERSION=1.0.0
docker tag lcyt-ffmpeg:local ${REGISTRY}/lcyt-ffmpeg:${VERSION}
docker push ${REGISTRY}/lcyt-ffmpeg:${VERSION}
```

Then update `docker-compose.yml` to use `${REGISTRY}/lcyt-ffmpeg:${VERSION}` instead of the local build image or run `docker compose pull` before restart.

4) Start socket-proxy, ffmpeg and backend (dev)

This will create the named volume `cea-pipes` and start the services defined in `docker-compose.yml`:

```bash
docker compose up -d docker-socket-proxy lcyt-ffmpeg lcyt-backend

# confirm containers are running
docker compose ps
# confirm volumes created
docker volume ls | grep cea-pipes || true
```

5) Toggle `FFMPEG_RUNNER=docker` (method A: env override)

Quick test without editing files (useful for a single restart):

```bash
FFMPEG_RUNNER=docker DOCKER_HOST=http://docker-socket-proxy:2375 CEA_PIPES_DIR=/var/cea-pipes \
  docker compose up -d --no-deps --build lcyt-backend
```

Method B: persist in `.env` used by compose (recommended for multi-restart):

```bash
# append or edit .env at repo root
cat >> .env <<'EOT'
FFMPEG_RUNNER=docker
DOCKER_HOST=http://docker-socket-proxy:2375
CEA_PIPES_DIR=/var/cea-pipes
EOT

docker compose up -d --no-deps --build lcyt-backend
```

6) Validate the rollout

- Check backend health endpoint:

```bash
curl -f http://localhost:3000/health
```

- Follow logs for errors related to docker runner or ffmpeg jobs:

```bash
docker compose logs -f lcyt-backend
```

- Verify the backend can start an ffmpeg runner container (example: run a small ffmpeg task via API or the CLI integration used in your environment). If your backend exposes an admin/test endpoint, use that. Otherwise inspect `docker ps` for short-lived ffmpeg containers.

7) Rollback to spawn fallback (immediate)

If something fails and you need to revert to the previous behavior (the backend spawning ffmpeg locally), set `FFMPEG_RUNNER=spawn` and restart just the backend:

Method A (one-off):

```bash
FFMPEG_RUNNER=spawn docker compose up -d --no-deps --build lcyt-backend
```

Method B (persisted .env):

```bash
# replace existing value in .env (POSIX sed example)
sed -i "s/^FFMPEG_RUNNER=.*/FFMPEG_RUNNER=spawn/" .env || \
  echo 'FFMPEG_RUNNER=spawn' >> .env

docker compose up -d --no-deps --build lcyt-backend
```

Confirm rollback:

```bash
docker compose logs -f lcyt-backend
curl -f http://localhost:3000/health
```

8) Cleanup (if needed)

To tear down the dev stack and remove volumes:

```bash
docker compose down
# remove the named volume if you want to reset local CEA pipes
docker volume rm live-captions-yt_cea-pipes || true
```

9) Security notes (socket-proxy)

- The `docker-socket-proxy` exposes the Docker API over TCP (2375). Do NOT expose this port to public networks.
- In production, run the socket-proxy on an isolated management network, restrict access with firewall rules, and use mTLS or an SSH tunnel if remote access is required.
- Prefer mounting the socket-proxy with a unix domain socket behind a managed reverse proxy and avoid binding 2375 to 0.0.0.0.

10) Troubleshooting

- If `docker compose up` fails to build `lcyt-ffmpeg`, re-run build with verbose output:

```bash
docker build --progress=plain -t lcyt-ffmpeg:local ./images/lcyt-ffmpeg
```

- If the backend cannot reach the proxy, validate connectivity from the backend container:

```bash
docker compose exec lcyt-backend sh -c "apk add --no-cache curl >/dev/null 2>&1 || true; curl -sS http://docker-socket-proxy:2375/_ping || true"
```

11) Releasing to production

- When ready, tag the ffmpeg image with a semver and push to your registry, update your production deployment manifests to use that tag, and roll using your normal deployment pipeline.

Example tag & push (repeat from step 3):

```bash
docker tag lcyt-ffmpeg:local registry.example.com/org/lcyt-ffmpeg:1.0.0
docker push registry.example.com/org/lcyt-ffmpeg:1.0.0
```

Then update your deployment to reference `registry.example.com/org/lcyt-ffmpeg:1.0.0`.

---

If you want, I can also add a small smoke-test script that posts a short ffmpeg job to the backend and verifies the expected docker container spin-up. Want me to add that next?
