# FFmpeg Docker Usage (wrapper and runner)

This document describes the minimal wrapper and runner support added for running ffmpeg inside Docker or on the host.

Files added:
- `docker/ffmpeg/Dockerfile` — Debian-slim image with ffmpeg and common codecs.
- `images/ffmpeg/README.md` — build/run snippet for the image.
- `scripts/ffmpeg-in-container.sh` — portable wrapper to run host ffmpeg or container ffmpeg.
- `packages/lcyt-backend/src/ffmpeg/docker-runner.js` — Docker runner updated to forward stdin (-i) and pipe stdio.
- `packages/lcyt-backend/src/ffmpeg/index.js` — factory now reads `FFMPEG_RUNNER`, `FFMPEG_IMAGE`, `FFMPEG_WRAPPER`.

Quick usage

1. Build the image locally:

```bash
docker build -t lcyt-ffmpeg:latest -f docker/ffmpeg/Dockerfile docker/ffmpeg
```

2. Run ffmpeg in container directly:

```bash
docker run --rm -i --entrypoint ffmpeg lcyt-ffmpeg:latest -- -version
```

3. Use the provided wrapper script (preferred for local dev):

```bash
# run host ffmpeg (default)
scripts/ffmpeg-in-container.sh -version

# run container ffmpeg
FFMPEG_RUNNER=docker FFMPEG_IMAGE=lcyt-ffmpeg:latest scripts/ffmpeg-in-container.sh -version
```

Notes and limitations
- The wrapper preserves stdin/stdout/stderr semantics and exit codes.
- On Windows, the wrapper is a Bash script; Windows users should use WSL or adapt to PowerShell.
- The Docker image is intentionally minimal. If you need additional codecs (libfdk-aac, NVENC), build a custom image.

Environment variables
- `FFMPEG_RUNNER` — `spawn` (default) or `docker`.
- `FFMPEG_IMAGE` — image to use when `FFMPEG_RUNNER=docker` (default `lcyt-ffmpeg:latest`).
- `FFMPEG_WRAPPER` — path to an alternative local wrapper/ffmpeg binary; when set, the backend factory will prefer it.

Testing
- An integration smoke test is added at `packages/lcyt-backend/test/integration/ffmpeg.docker.smoke.test.js`. It is skipped unless `DOCKER_AVAILABLE=1`.
 
 Python tests & prerequisites
 
 - Ensure Python development dependencies are installed before running the Python test suite. From the repository root run:
 
 ```bash
 python -m venv .venv
 .venv\Scripts\activate   # Windows (or `source .venv/bin/activate` on Unix)
 pip install -r python-packages/lcyt-backend/requirements.txt
 ```
 
 - Run Python tests with `pytest` from the project root (inside the virtualenv). On Windows prefer WSL when running scripts that assume a Unix-like shell:
 
 ```bash
 # Activate virtualenv (Unix)
 source .venv/bin/activate
 # Run tests
 pytest -q python-packages/lcyt-backend
 
 # On Windows (use WSL) or ensure your shell supports required tooling
 # In WSL:
 # source .venv/bin/activate
 # pytest -q python-packages/lcyt-backend
 ```
 
 - Note: Some CI/test runners may not have `pytest` installed by default; installing the requirements file above ensures `pytest` and test dependencies are available.
