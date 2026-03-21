#!/usr/bin/env bash
set -euo pipefail

# Wrapper to run ffmpeg either on the host or inside Docker.
# Usage: ffmpeg-in-container.sh [ffmpeg args...]
# Environment:
#  FFMPEG_RUNNER - "spawn" (default) to run host ffmpeg, or "docker" to run inside docker
#  FFMPEG_IMAGE  - docker image to use when runner=docker (default: lcyt-ffmpeg:latest)

runner="${FFMPEG_RUNNER:-spawn}"
image="${FFMPEG_IMAGE:-lcyt-ffmpeg:latest}"

if [ "$runner" = "spawn" ] || [ "$runner" = "local" ]; then
  # Replace shell with host ffmpeg; preserves stdin/stdout/stderr and exit code
  exec ffmpeg "$@"
elif [ "$runner" = "docker" ]; then
  # Run ffmpeg inside docker, keep stdin attached using -i so streaming works
  docker run --rm -i --entrypoint ffmpeg "$image" -- "$@"
  rc=$?
  exit $rc
else
  echo "Unknown FFMPEG_RUNNER: $runner" >&2
  exit 2
fi
