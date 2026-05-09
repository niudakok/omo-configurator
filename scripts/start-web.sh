#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT=1420
API_PORT=1422
API_URL="http://127.0.0.1:${API_PORT}/api/runtime"
WEB_URL="http://localhost:${PORT}/"
API_LOG="/tmp/omo-configurator-api.log"
VITE_LOG="/tmp/omo-configurator-vite.log"

if ! command -v npm >/dev/null 2>&1; then
  printf 'Error: npm is not installed or not in PATH.\n' >&2
  exit 1
fi

if ! command -v ss >/dev/null 2>&1; then
  printf 'Error: ss is not installed or not in PATH.\n' >&2
  exit 1
fi

if [ ! -d "$ROOT_DIR/node_modules" ]; then
  printf 'node_modules not found. Running install first...\n'
  "$ROOT_DIR/scripts/install.sh"
fi

port_listener() {
  ss -ltnp | grep ":$1 " || true
}

probe_url() {
  node -e "fetch(process.argv[1]).then(r=>process.exit(r.ok ? 0 : 1)).catch(()=>process.exit(1))" "$1"
}

print_status() {
  printf 'Mode:       server-backed\n'
  printf 'Config API: http://127.0.0.1:%s\n' "$API_PORT"
  printf 'Web UI:     %s\n' "$WEB_URL"
  printf 'Behavior:   reads/writes real WSL config files\n'
}

API_LISTENER="$(port_listener "$API_PORT")"
WEB_LISTENER="$(port_listener "$PORT")"
STARTED_API=0

start_api_server() {
  printf 'Starting local config API on port %s...\n' "$API_PORT"
  (cd "$ROOT_DIR" && npm run dev:api >"$API_LOG" 2>&1) &
  API_PID=$!
  STARTED_API=1
  for _ in $(seq 1 40); do
    if port_listener "$API_PORT" >/dev/null; then
      if probe_url "$API_URL"; then
        return 0
      fi
    fi
    sleep 0.25
  done
  printf 'Error: local config API failed to start.\n' >&2
  if [ -f "$API_LOG" ]; then
    printf '--- API log ---\n' >&2
    cat "$API_LOG" >&2
    printf '--- end API log ---\n' >&2
  fi
  exit 1
}

if [ -n "$API_LISTENER" ]; then
  if probe_url "$API_URL"; then
    printf 'Local config API is already running on port %s.\n' "$API_PORT"
    printf 'API listener: %s\n' "$API_LISTENER"
  else
    printf 'Error: port %s is occupied, but the local config API did not respond correctly.\n' "$API_PORT" >&2
    printf 'Listener: %s\n' "$API_LISTENER" >&2
    exit 1
  fi
else
  start_api_server
fi

if [ -n "$WEB_LISTENER" ]; then
  printf 'Browser mode is already running on port %s.\n' "$PORT"
  printf 'Web listener: %s\n' "$WEB_LISTENER"
  print_status
  exit 0
fi

cleanup() {
  if [ "$STARTED_API" -eq 1 ] && [ -n "${API_PID:-}" ]; then
    kill "$API_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

printf 'Starting server-backed web mode...\n'
print_status
npm run dev:browser --prefix "$ROOT_DIR" -- "$@"
