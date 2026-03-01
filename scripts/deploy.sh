#!/usr/bin/env bash
# deploy.sh — Clone or pull the repo, build the web UI, and start the backend.
#
# Usage:
#   ./scripts/deploy.sh [REPO_DIR]
#
# Arguments:
#   REPO_DIR   Path to clone/update the repo (default: ~/lcyt)
#
# Required environment variables (can also be set in a .env file next to
# the script, or exported before running):
#   REPO_URL   Git remote URL  (e.g. git@github.com:you/live-captions-yt.git)
#   JWT_SECRET  Required by the backend
#
# Optional environment variables:
#   GIT_BRANCH           Branch to check out (default: main)
#   FREE_APIKEY_ACTIVE   Set to 1 to enable free-tier sign-up (default: 0)
#
# After the first deploy, symlink your web root once:
#   ln -sfn /path/to/REPO_DIR/packages/lcyt-web/dist /var/www/html/lcyt
# Subsequent deploys update dist/ in-place; the symlink needs no changes.

set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load .env next to the script if it exists
ENV_FILE="$SCRIPT_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

REPO_DIR="${1:-${REPO_DIR:-$HOME/lcyt}}"
REPO_URL="${REPO_URL:-}"
GIT_BRANCH="${GIT_BRANCH:-main}"

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

if [[ -z "$REPO_URL" && ! -d "$REPO_DIR/.git" ]]; then
  echo "Error: REPO_URL must be set for an initial clone." >&2
  echo "  export REPO_URL=git@github.com:you/live-captions-yt.git" >&2
  exit 1
fi

if [[ -z "${JWT_SECRET:-}" ]]; then
  echo "Warning: JWT_SECRET is not set — the backend will auto-generate one." >&2
  echo "  This means all existing tokens become invalid on restart." >&2
fi

# ---------------------------------------------------------------------------
# Step 1: Clone or pull
# ---------------------------------------------------------------------------

if [[ -d "$REPO_DIR/.git" ]]; then
  echo "==> Pulling latest ($GIT_BRANCH) into $REPO_DIR"
  git -C "$REPO_DIR" fetch origin "$GIT_BRANCH"
  git -C "$REPO_DIR" checkout "$GIT_BRANCH"
  git -C "$REPO_DIR" reset --hard "origin/$GIT_BRANCH"
else
  echo "==> Cloning $REPO_URL into $REPO_DIR"
  git clone --branch "$GIT_BRANCH" "$REPO_URL" "$REPO_DIR"
fi

# ---------------------------------------------------------------------------
# Step 2: Install Node dependencies
# ---------------------------------------------------------------------------

echo "==> Installing Node dependencies (production)"
npm install \
  --prefix "$REPO_DIR" \
  --workspace packages/lcyt \
  --workspace packages/lcyt-backend \
  --omit=dev 2>&1 | tail -5

echo "==> Installing lcyt-web dependencies (includes dev for build)"
npm install \
  --prefix "$REPO_DIR" \
  --workspace packages/lcyt-web 2>&1 | tail -5

# ---------------------------------------------------------------------------
# Step 3: Build the web UI
# ---------------------------------------------------------------------------

echo "==> Building lcyt-web"
npm run build -w packages/lcyt-web --prefix "$REPO_DIR"
echo "    Built → $REPO_DIR/packages/lcyt-web/dist"

# ---------------------------------------------------------------------------
# Step 4: Start / restart the backend via Docker Compose
# ---------------------------------------------------------------------------

COMPOSE_DIR="$REPO_DIR/packages/lcyt-backend"

echo "==> Starting backend (docker compose up -d)"
docker compose \
  --project-directory "$COMPOSE_DIR" \
  -f "$COMPOSE_DIR/docker-compose.yml" \
  up -d --build --remove-orphans

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------

echo ""
echo "Deploy complete."
echo "  Backend:  http://localhost:3000/health"
echo "  Web dist: $REPO_DIR/packages/lcyt-web/dist"
echo ""
echo "To serve the web UI, symlink your web root once:"
echo "  ln -sfn $REPO_DIR/packages/lcyt-web/dist /var/www/html/lcyt"
