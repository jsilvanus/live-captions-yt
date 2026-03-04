#!/usr/bin/env bash
# =============================================================================
# nginxbot.sh — Add an nginx RTMP block for lcyt stream ingestion
#
# Usage:
#   ./scripts/nginxbot.sh <nginx-site-config> [options]
#
# Arguments:
#   <nginx-site-config>   Path to an nginx sites-available config file
#                         (e.g. /etc/nginx/sites-available/lcyt)
#
# Options:
#   --rtmp-host HOST      Hostname for the RTMP server  (default: rtmp.lcyt.fi)
#   --api-host  HOST      Hostname for the API callbacks (default: api.lcyt.fi)
#   --rtmp-port PORT      RTMP listen port               (default: 1935)
#   --app-name  NAME      RTMP application name          (default: stream)
#   --control-port PORT   HTTP port for the rtmp_control endpoint
#                         (default: 8888, bound to 127.0.0.1 only)
#   --help                Show this help message
#
# What it does:
#   1. Parses the provided nginx site config file.
#   2. Checks whether an rtmp { } block already exists at the top level of the
#      nginx config (or in /etc/nginx/nginx.conf).
#   3. If not, appends a complete rtmp { } block to the site config file.
#      The block configures:
#        - An `app <app-name>` that listens for incoming RTMP streams.
#        - Paths of the form rtmp://<rtmp-host>/<app-name>/<APIKEY>.
#        - on_publish      → POST http://<api-host>/rtmp  (start relay)
#        - on_publish_done → POST http://<api-host>/rtmp  (stop relay)
#   4. Appends an HTTP server block (bound to 127.0.0.1:<control-port>) that
#      exposes the nginx-rtmp control API at /control.
#      The backend uses this to forcefully drop publishers:
#        POST http://127.0.0.1:<control-port>/control/drop/publisher?app=<app>&name=<apiKey>
#
# Requirements:
#   - nginx with the nginx-rtmp-module (or libnginx-mod-rtmp) installed.
#   - Write permission to the site config file (usually requires root / sudo).
#
# Example:
#   sudo ./scripts/nginxbot.sh /etc/nginx/sites-available/lcyt \
#        --rtmp-host rtmp.lcyt.fi \
#        --api-host  api.lcyt.fi
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

RTMP_HOST="rtmp.lcyt.fi"
API_HOST="api.lcyt.fi"
RTMP_PORT="1935"
APP_NAME="stream"
CONTROL_PORT="8888"
SITE_CONFIG=""

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

show_help() {
  sed -n '2,/^# ====/p' "$0" | grep '^#' | sed 's/^# \?//'
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)       show_help ;;
    --rtmp-host)     RTMP_HOST="$2";    shift 2 ;;
    --api-host)      API_HOST="$2";     shift 2 ;;
    --rtmp-port)     RTMP_PORT="$2";    shift 2 ;;
    --app-name)      APP_NAME="$2";     shift 2 ;;
    --control-port)  CONTROL_PORT="$2"; shift 2 ;;
    -*)              echo "Unknown option: $1" >&2; exit 1 ;;
    *)
      if [[ -z "$SITE_CONFIG" ]]; then
        SITE_CONFIG="$1"
      else
        echo "Unexpected argument: $1" >&2; exit 1
      fi
      shift
      ;;
  esac
done

if [[ -z "$SITE_CONFIG" ]]; then
  echo "Error: site config path is required." >&2
  echo "Usage: $0 <nginx-site-config> [options]" >&2
  exit 1
fi

if [[ ! -f "$SITE_CONFIG" ]]; then
  echo "Error: '$SITE_CONFIG' does not exist or is not a file." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Check if rtmp block already exists
# ---------------------------------------------------------------------------

NGINX_CONF="${NGINX_CONF:-/etc/nginx/nginx.conf}"

check_rtmp_exists() {
  local file="$1"
  grep -qE '^\s*rtmp\s*\{' "$file" 2>/dev/null
}

if check_rtmp_exists "$SITE_CONFIG"; then
  echo "✓ rtmp { } block already found in $SITE_CONFIG — no changes made."
  exit 0
fi

if [[ -f "$NGINX_CONF" ]] && check_rtmp_exists "$NGINX_CONF"; then
  echo "✓ rtmp { } block already found in $NGINX_CONF — no changes made."
  exit 0
fi

# Check all files included from nginx.conf
if [[ -f "$NGINX_CONF" ]]; then
  while IFS= read -r incl; do
    # Expand glob patterns from include directives
    for f in $incl; do
      [[ -f "$f" ]] && check_rtmp_exists "$f" && {
        echo "✓ rtmp { } block already found in $f — no changes made."
        exit 0
      }
    done
  done < <(grep -oE 'include\s+[^;]+' "$NGINX_CONF" 2>/dev/null | sed 's/include[[:space:]]*//' || true)
fi

# ---------------------------------------------------------------------------
# Check if control endpoint already exists
# ---------------------------------------------------------------------------

check_control_exists() {
  local file="$1"
  grep -qE 'rtmp_control' "$file" 2>/dev/null
}

CONTROL_EXISTS=false
if check_control_exists "$SITE_CONFIG"; then
  CONTROL_EXISTS=true
  echo "✓ rtmp_control already found in $SITE_CONFIG — skipping control block."
fi

if [[ -f "$NGINX_CONF" ]] && check_control_exists "$NGINX_CONF"; then
  CONTROL_EXISTS=true
  echo "✓ rtmp_control already found in $NGINX_CONF — skipping control block."
fi

if [[ "$CONTROL_EXISTS" == "false" ]] && [[ -f "$NGINX_CONF" ]]; then
  while IFS= read -r incl; do
    for f in $incl; do
      [[ -f "$f" ]] && check_control_exists "$f" && {
        CONTROL_EXISTS=true
        echo "✓ rtmp_control already found in $f — skipping control block."
        break 2
      }
    done
  done < <(grep -oE 'include\s+[^;]+' "$NGINX_CONF" 2>/dev/null | sed 's/include[[:space:]]*//' || true)
fi

# ---------------------------------------------------------------------------
# Build and append the rtmp block
# ---------------------------------------------------------------------------

echo "→ Appending rtmp { } block to $SITE_CONFIG"

cat >> "$SITE_CONFIG" << RTMP_BLOCK

# ── RTMP ingestion block (added by nginxbot.sh) ──────────────────────────────
# nginx-rtmp always sends POST with application/x-www-form-urlencoded body.
# Both on_publish and on_publish_done point to the same /rtmp endpoint;
# the backend distinguishes them via the 'call' field (publish / publish_done).
rtmp {
    server {
        listen ${RTMP_PORT};
        chunk_size 4096;

        application ${APP_NAME} {
            live on;
            record off;

            # Single callback URL for both publish start and end.
            # nginx-rtmp sets: call=publish or call=publish_done, app=<app>, name=<stream>
            on_publish      http://${API_HOST}/rtmp;
            on_publish_done http://${API_HOST}/rtmp;
        }
    }
}
RTMP_BLOCK

echo "✓ RTMP block appended."

# ---------------------------------------------------------------------------
# Append HTTP control server block (localhost only) if not already present
# ---------------------------------------------------------------------------

if [[ "$CONTROL_EXISTS" == "false" ]]; then
  echo "→ Appending HTTP control server block (127.0.0.1:${CONTROL_PORT}) to $SITE_CONFIG"

  cat >> "$SITE_CONFIG" << CONTROL_BLOCK

# ── nginx-rtmp control endpoint (added by nginxbot.sh) ───────────────────────
# Bound to loopback only. The backend uses this to forcefully drop publishers:
#   POST http://127.0.0.1:${CONTROL_PORT}/control/drop/publisher?app=${APP_NAME}&name=<APIKEY>
# Set RTMP_CONTROL_URL=http://127.0.0.1:${CONTROL_PORT}/control in the backend .env
server {
    listen 127.0.0.1:${CONTROL_PORT};
    server_name localhost;

    location /control {
        rtmp_control all;
    }
}
CONTROL_BLOCK

  echo "✓ Control block appended."
  echo ""
  echo "  Set in your backend .env:"
  echo "    RTMP_CONTROL_URL=http://127.0.0.1:${CONTROL_PORT}/control"
fi

echo ""
echo "Reload nginx to apply changes:"
echo "    sudo nginx -t && sudo systemctl reload nginx"
echo ""
echo "Stream path: rtmp://${RTMP_HOST}:${RTMP_PORT}/${APP_NAME}/<APIKEY>"
