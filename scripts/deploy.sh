#!/usr/bin/env bash
# deploy.sh — Clone or pull the repo, build the web UI, and start the lcyt-site container.
#
# The container runs lcyt-backend (port 3000) and lcyt-mcp-sse (port 3001).
# lcyt-web is built on the host and served by nginx via a symlink to
# packages/lcyt-web/dist/ — it is NOT included in the Docker image.
#
# Usage:
#   ./scripts/deploy.sh [REPO_DIR]
#
# Arguments:
#   REPO_DIR   Path to clone/update the repo (default: ~/lcyt)
#
# Required environment variables (can also be set in a .env file next to
# the script, or exported before running):
#   REPO_URL    Git remote URL  (e.g. git@github.com:you/live-captions-yt.git)
#   JWT_SECRET  Required by the backend
#
# Optional environment variables:
#   GIT_BRANCH           Branch to check out (default: main)
#   FREE_APIKEY_ACTIVE   Set to 1 to enable free-tier sign-up (default: 0)
#   MCP_REQUIRE_API_KEY  Set to 1 to require X-Api-Key on MCP SSE connections
#
# nginx symlink (run once after first deploy):
#   ln -sfn ~/lcyt/packages/lcyt-web/dist /var/www/html/lcyt

set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

set -a
# Load .env next to the script if it exists
ENV_FILE="$SCRIPT_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

REPO_DIR="${1:-${REPO_DIR:-$HOME/lcyt}}"
REPO_URL="${REPO_URL:-}"
GIT_BRANCH="${GIT_BRANCH:-main}"
set +a

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
# Step 2: Build lcyt-web on the host (served by nginx, not included in Docker)
# ---------------------------------------------------------------------------

echo "==> Installing lcyt-web dependencies (includes devDependencies for Vite build)"
LOG="$REPO_DIR/lcyt-web-npm-install.log"
rm -f "$LOG"
# Use --include=dev so devDependencies (Vite) are installed even if NODE_ENV=production
npm ci \
  --prefix "$REPO_DIR" \
  --workspace packages/lcyt-web \
  --include=dev 2>&1 | tee "$LOG"
echo "    Install log: $LOG"
tail -n 20 "$LOG" || true

echo "==> Building lcyt-web"
BUILD_LOG="$REPO_DIR/lcyt-web-build.log"
rm -f "$BUILD_LOG"
npm run build -w packages/lcyt-web --prefix "$REPO_DIR" 2>&1 | tee "$BUILD_LOG"
echo "    Built → $REPO_DIR/packages/lcyt-web/dist"
echo "    Build log: $BUILD_LOG"

# ---------------------------------------------------------------------------
# Step 3: Start / restart the site container via Docker Compose
# ---------------------------------------------------------------------------

COMPOSE_DIR="$REPO_DIR/packages/lcyt-site"

echo "==> Starting lcyt-site (docker compose up -d)"
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
echo "  MCP SSE:  http://localhost:3001/sse"
echo "  Web UI:   in lcyt-web/dist, served by host nginx; see nginx symlink in this script"
echo ""
