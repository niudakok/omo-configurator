#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT=1420
API_PORT=1422
API_URL="http://127.0.0.1:${API_PORT}/api/runtime"
WEB_URL="http://localhost:${PORT}/"
API_LOG="/tmp/omo-configurator-api.log"
VITE_LOG="/tmp/omo-configurator-vite.log"
RUN_DIR="/tmp/omo-configurator"
API_PID_FILE="${RUN_DIR}/web-api.pid"
VITE_PID_FILE="${RUN_DIR}/web-vite.pid"

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

mkdir -p "$RUN_DIR"

port_listener() {
  ss -ltnp | grep ":$1 " || true
}

pid_is_running() {
  local pid="$1"
  [ -n "$pid" ] && kill -0 "$pid" >/dev/null 2>&1
}

read_pid_file() {
  local file="$1"
  if [ -f "$file" ]; then
    tr -d '[:space:]' < "$file"
  fi
}

write_pid_file() {
  local file="$1"
  local pid="$2"
  printf '%s\n' "$pid" > "$file"
}

clear_pid_file() {
  local file="$1"
  rm -f "$file"
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
STARTED_VITE=0

API_PID_FROM_FILE="$(read_pid_file "$API_PID_FILE")"
if [ -n "$API_PID_FROM_FILE" ] && ! pid_is_running "$API_PID_FROM_FILE"; then
  clear_pid_file "$API_PID_FILE"
fi

VITE_PID_FROM_FILE="$(read_pid_file "$VITE_PID_FILE")"
if [ -n "$VITE_PID_FROM_FILE" ] && ! pid_is_running "$VITE_PID_FROM_FILE"; then
  clear_pid_file "$VITE_PID_FILE"
fi

start_api_server() {
  printf 'Starting local config API on port %s...\n' "$API_PORT"
  (cd "$ROOT_DIR" && npm run dev:api >"$API_LOG" 2>&1) &
  API_PID=$!
  STARTED_API=1
  write_pid_file "$API_PID_FILE" "$API_PID"
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

start_vite_server() {
  printf 'Starting server-backed web mode...\n'
  print_status
  (cd "$ROOT_DIR" && npm run dev:browser -- "$@" >"$VITE_LOG" 2>&1) &
  VITE_PID=$!
  STARTED_VITE=1
  write_pid_file "$VITE_PID_FILE" "$VITE_PID"
  for _ in $(seq 1 40); do
    if port_listener "$PORT" >/dev/null; then
      return 0
    fi
    sleep 0.25
  done
  printf 'Error: browser mode failed to start on port %s.\n' "$PORT" >&2
  if [ -f "$VITE_LOG" ]; then
    printf '--- Vite log ---\n' >&2
    cat "$VITE_LOG" >&2
    printf '--- end Vite log ---\n' >&2
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
    clear_pid_file "$API_PID_FILE"
  fi
  if [ "$STARTED_VITE" -eq 1 ] && [ -n "${VITE_PID:-}" ]; then
    kill "$VITE_PID" >/dev/null 2>&1 || true
    clear_pid_file "$VITE_PID_FILE"
  fi
}

trap cleanup EXIT INT TERM

start_vite_server "$@"

clear_pid_file "$API_PID_FILE"
clear_pid_file "$VITE_PID_FILE"
trap - EXIT INT TERM
wait "$VITE_PID"
