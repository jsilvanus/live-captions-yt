#!/usr/bin/env bash
# deploy.sh — Clone or pull the repo, build the web UI, and start the lcyt-site container.
#
# The container runs lcyt-backend (port 3000) and lcyt-mcp-sse (port 3001).
# lcyt-web is built on the host and served by nginx via a symlink to
# packages/lcyt-web/dist/ — it is NOT included in the Docker image.
#
# Usage:
#   ./scripts/deploy.sh [--only TARGET] [REPO_DIR]
#
# Arguments:
#   --only TARGET  Build/deploy only one component (skips git pull). Valid targets:
#                    app          Rebuild lcyt-web
#                    backend      Rebuild & restart Docker backend
#                    screenshots  Recapture UI screenshots
#                    bridge       Rebuild lcyt-bridge executables
#                    site         Rebuild lcyt-site
#   REPO_DIR       Path to clone/update the repo (default: ~/lcyt)
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
# Argument parsing
# ---------------------------------------------------------------------------

ONLY_TARGET=""
POSITIONAL_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --only)
      ONLY_TARGET="${2:-}"
      if [[ -z "$ONLY_TARGET" ]]; then
        echo "Error: --only requires a target argument." >&2
        exit 1
      fi
      shift 2
      ;;
    *)
      POSITIONAL_ARGS+=("$1")
      shift
      ;;
  esac
done
set -- "${POSITIONAL_ARGS[@]+"${POSITIONAL_ARGS[@]}"}"

# Validate --only value
_VALID_TARGETS="app backend screenshots bridge site"
if [[ -n "$ONLY_TARGET" ]]; then
  _valid=0
  for _t in $_VALID_TARGETS; do
    [[ "$ONLY_TARGET" == "$_t" ]] && { _valid=1; break; }
  done
  if [[ $_valid -eq 0 ]]; then
    echo "Error: unknown --only target '$ONLY_TARGET'." >&2
    echo "  Valid targets: $_VALID_TARGETS" >&2
    exit 1
  fi
fi

# Helper: returns 0 (true) if a given step should run
_should_run() { [[ -z "$ONLY_TARGET" || "$ONLY_TARGET" == "$1" ]]; }

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
# Step 1: Clone or pull (always runs)
# ---------------------------------------------------------------------------

if [[ -d "$REPO_DIR/.git" ]]; then
    echo "==> Pulling latest ($GIT_BRANCH) into $REPO_DIR"

    # Record the current SHA of this deploy script before pulling so we can
    # detect whether it changed and re-execute the updated version.
    _DEPLOY_SCRIPT_IN_REPO="$REPO_DIR/scripts/deploy.sh"

    # Calculate checksum of the currently-running script (this file). After
    # pulling, we'll compare this to the repo copy and re-exec if they differ.
    _SELF_DEPLOY_SHA=""
    if [[ -f "${BASH_SOURCE[0]}" ]]; then
      _SELF_DEPLOY_SHA=$(sha256sum "${BASH_SOURCE[0]}" | cut -d' ' -f1)
    fi

    git -C "$REPO_DIR" fetch origin "$GIT_BRANCH"
    git -C "$REPO_DIR" checkout "$GIT_BRANCH"
    git -C "$REPO_DIR" reset --hard "origin/$GIT_BRANCH"

    # Self-check: if deploy.sh changed in this pull, re-execute from the repo.
    # The exec replaces the current process, so the new script runs from the
    # beginning. On the second run the SHA will match (nothing new to pull),
    # so the re-exec does NOT trigger again — no infinite loop.
    # If the updated script has a syntax error, bash will exit non-zero before
    # any destructive steps, keeping the deployment safely aborted.
    if [[ -f "$_DEPLOY_SCRIPT_IN_REPO" ]]; then
      _NEW_DEPLOY_SHA=$(sha256sum "$_DEPLOY_SCRIPT_IN_REPO" | cut -d' ' -f1)
      if [[ -n "$_SELF_DEPLOY_SHA" && "$_SELF_DEPLOY_SHA" != "$_NEW_DEPLOY_SHA" ]]; then
        echo "==> deploy.sh has been updated — re-executing the new version from repo…"
        exec bash "$_DEPLOY_SCRIPT_IN_REPO" "$@"
      fi
    fi
  else
    echo "==> Cloning $REPO_URL into $REPO_DIR"
    git clone --branch "$GIT_BRANCH" "$REPO_URL" "$REPO_DIR"
  fi

# ---------------------------------------------------------------------------
# Step 2: Build lcyt-web on the host (served by nginx, not included in Docker)
# ---------------------------------------------------------------------------

if _should_run app; then
  echo "==> Installing lcyt-web dependencies (includes devDependencies for Vite build)"
  LOG="$REPO_DIR/lcyt-web-npm-install.log"
  rm -f "$LOG"
  # Use --include=dev so devDependencies (Vite) are installed even if NODE_ENV=production
  (cd "$REPO_DIR" && npm ci --workspace packages/lcyt-web --include=dev) 2>&1 | tee "$LOG" || \
    echo "Warning: lcyt-web npm install failed (non-fatal) — web UI may not be updated."
  echo "    Install log: $LOG"
  tail -n 20 "$LOG" || true

  echo "==> Building lcyt-web"
  BUILD_LOG="$REPO_DIR/lcyt-web-build.log"
  rm -f "$BUILD_LOG"
  (cd "$REPO_DIR" && npm run build -w packages/lcyt-web) 2>&1 | tee "$BUILD_LOG" || \
    echo "Warning: lcyt-web build failed (non-fatal) — web UI dist may not be updated."
  echo "    Built → $REPO_DIR/packages/lcyt-web/dist"
  echo "    Build log: $BUILD_LOG"
fi

# ---------------------------------------------------------------------------
# Step 2b: Capture UI screenshots in the background
# (requires lcyt-web dist; result is needed before lcyt-site build)
# ---------------------------------------------------------------------------

ROOT_DEV_LOG="$REPO_DIR/root-npm-install.log"
SCREENSHOTS_LOG="$REPO_DIR/screenshots.log"
_SCREENSHOTS_PID=""

if _should_run screenshots; then
  (
    echo "==> [bg] Installing root devDependencies (playwright, etc.)"
    rm -f "$ROOT_DEV_LOG"
    (cd "$REPO_DIR" && npm install --include=dev) >"$ROOT_DEV_LOG" 2>&1 || \
      { echo "Warning: root npm install failed — screenshots may not run." >>"$ROOT_DEV_LOG"; }

    echo "==> [bg] Installing Playwright Chromium browser"
    npx --prefix "$REPO_DIR" playwright install chromium >>"$ROOT_DEV_LOG" 2>&1 || true

    echo "==> [bg] Capturing UI screenshots"
    rm -f "$SCREENSHOTS_LOG"
    npm run screenshots --prefix "$REPO_DIR" >"$SCREENSHOTS_LOG" 2>&1 || \
      echo "Warning: screenshot capture failed (non-fatal) — site will build without updated screenshots." >>"$SCREENSHOTS_LOG"
    echo "    Screenshots log: $SCREENSHOTS_LOG"
  ) &
  _SCREENSHOTS_PID=$!
  echo "==> UI screenshot capture started in background (PID $_SCREENSHOTS_PID)"
fi

# ---------------------------------------------------------------------------
# Step 3: Start / restart the backend container via Docker Compose
# (done before lcyt-site build so the backend is live as soon as possible)
# ---------------------------------------------------------------------------

if _should_run backend; then
  COMPOSE_DIR="$REPO_DIR"

  echo "==> Starting backend (docker compose up -d)"
  docker compose \
    --project-directory "$COMPOSE_DIR" \
    -f "$COMPOSE_DIR/docker-compose.yml" \
    up -d --build --pull=always --remove-orphans
fi

# ---------------------------------------------------------------------------
# Step 2c (cont.): Wait for background job (root npm install + screenshots)
# ---------------------------------------------------------------------------

# Wait for background job to finish — it installs all devDependencies (including
# esbuild for lcyt-bridge) and captures screenshots needed by the Astro build.
if [[ -n "$_SCREENSHOTS_PID" ]]; then
  echo "==> Waiting for background job (npm install + screenshots, PID $_SCREENSHOTS_PID)…"
  wait "$_SCREENSHOTS_PID" || echo "Warning: screenshot background job exited non-zero — continuing."
  echo "==> Background job done."
fi

# ---------------------------------------------------------------------------
# Step 2d: Build lcyt-bridge executables (after root npm install completes)
# ---------------------------------------------------------------------------

if _should_run bridge; then
  echo "==> Building lcyt-bridge executables (win, mac, linux, linux-arm64)"
  BRIDGE_BUILD_LOG="$REPO_DIR/lcyt-bridge-build.log"
  rm -f "$BRIDGE_BUILD_LOG"
  (
    cd "$REPO_DIR/packages/lcyt-bridge"
    npm run build:win 2>&1
    npm run build:mac 2>&1
    npm run build:linux 2>&1
    npm run build:linux-arm64 2>&1
  ) | tee "$BRIDGE_BUILD_LOG" || \
    echo "Warning: lcyt-bridge build failed (non-fatal) — bridge executables will not be updated."
  echo "    Built → $REPO_DIR/packages/lcyt-bridge/dist"
  echo "    Build log: $BRIDGE_BUILD_LOG"

  # Symlink the bridge dist into lcyt-site/dist so nginx serves the
  # executables at /downloads/bridge/ through the public marketing site.
  if [[ -d "$REPO_DIR/packages/lcyt-site/dist" ]]; then
    mkdir -p "$REPO_DIR/packages/lcyt-site/dist/downloads"
    ln -sfn "$REPO_DIR/packages/lcyt-bridge/dist" "$REPO_DIR/packages/lcyt-site/dist/downloads/bridge"
    echo "==> Symlinked lcyt-site/dist/downloads/bridge → $REPO_DIR/packages/lcyt-bridge/dist"
  fi
fi

# ---------------------------------------------------------------------------
# Step 2e: Build lcyt-site
# ---------------------------------------------------------------------------

if _should_run site; then
  echo "==> Installing lcyt-site dependencies (includes devDependencies for Astro build)"
  SITE_LOG="$REPO_DIR/lcyt-site-npm-install.log"
  rm -f "$SITE_LOG"
  # Use --include=dev so devDependencies (Astro) are installed even if NODE_ENV=production
  (cd "$REPO_DIR" && npm ci --workspace packages/lcyt-site --include=dev) 2>&1 | tee "$SITE_LOG" || \
    echo "Warning: lcyt-site npm install failed (non-fatal) — site may not be updated."
  echo "    Install log: $SITE_LOG"
  tail -n 20 "$SITE_LOG" || true

  echo "==> Building lcyt-site"
  SITE_BUILD_LOG="$REPO_DIR/lcyt-site-build.log"
  rm -f "$SITE_BUILD_LOG"
  (cd "$REPO_DIR" && npm run build -w packages/lcyt-site) 2>&1 | tee "$SITE_BUILD_LOG" || \
    echo "Warning: lcyt-site build failed (non-fatal) — site dist may not be updated."
  echo "    Built → $REPO_DIR/packages/lcyt-site/dist"
  echo "    Build log: $SITE_BUILD_LOG"
fi

# Give services a moment to initialize, then show logs for troubleshooting
if [[ -z "$ONLY_TARGET" ]]; then
  COMPOSE_DIR="$REPO_DIR"
  echo "==> Showing docker compose logs (follow). Press Ctrl-C to exit."
  docker compose \
    --project-directory "$COMPOSE_DIR" \
    -f "$COMPOSE_DIR/docker-compose.yml" \
    logs --follow --tail=200
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------

echo ""
echo "Deploy complete."
echo "  Main site: in packages/lcyt-site/dist, served by host nginx; see nginx symlink in this script"
echo "  Backend:   http://localhost:3000/health"
echo "  MCP SSE:   http://localhost:3001/sse"
echo "  Web UI:    in lcyt-web/dist, served by host nginx; see nginx symlink in this script"
echo "  Bridge:    executables at /downloads/bridge/ (served via lcyt-site dist) — win/mac/linux/linux-arm64"
echo ""
