#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT=1420
API_PORT=1422
RUN_DIR="/tmp/omo-configurator"
API_PID_FILE="${RUN_DIR}/web-api.pid"
VITE_PID_FILE="${RUN_DIR}/web-vite.pid"

if ! command -v ss >/dev/null 2>&1; then
  printf 'Error: ss is not installed or not in PATH.\n' >&2
  exit 1
fi

if ! command -v fuser >/dev/null 2>&1; then
  printf 'Error: fuser is not installed or not in PATH.\n' >&2
  exit 1
fi

read_pid_file() {
  local file="$1"
  if [ -f "$file" ]; then
    tr -d '[:space:]' < "$file"
  fi
}

pid_is_running() {
  local pid="$1"
  [ -n "$pid" ] && kill -0 "$pid" >/dev/null 2>&1
}

stop_pid() {
  local pid="$1"
  local label="$2"
  if pid_is_running "$pid"; then
    printf 'Stopping %s (pid %s)...\n' "$label" "$pid"
    kill "$pid" >/dev/null 2>&1 || true
    for _ in $(seq 1 20); do
      if ! pid_is_running "$pid"; then
        return 0
      fi
      sleep 0.25
    done
    printf 'Force killing %s (pid %s)...\n' "$label" "$pid"
    kill -9 "$pid" >/dev/null 2>&1 || true
  fi
}

stop_port_fallback() {
  local port="$1"
  local label="$2"
  local listener
  listener="$(ss -ltnp | grep ":$port " || true)"
  if [ -z "$listener" ]; then
    return 0
  fi
  printf 'Stopping %s by port fallback (%s)...\n' "$label" "$port"
  fuser -k -TERM "${port}/tcp" >/dev/null 2>&1 || true
  for _ in $(seq 1 20); do
    if ! ss -ltnp | grep -q ":$port "; then
      return 0
    fi
    sleep 0.25
  done
  printf 'Force killing %s by port fallback (%s)...\n' "$label" "$port"
  fuser -k -KILL "${port}/tcp" >/dev/null 2>&1 || true
}

API_PID="$(read_pid_file "$API_PID_FILE")"
VITE_PID="$(read_pid_file "$VITE_PID_FILE")"

if [ -n "$VITE_PID" ]; then
  stop_pid "$VITE_PID" "Vite"
  rm -f "$VITE_PID_FILE"
else
  stop_port_fallback "$PORT" "Vite"
fi

if [ -n "$API_PID" ]; then
  stop_pid "$API_PID" "local config API"
  rm -f "$API_PID_FILE"
else
  stop_port_fallback "$API_PORT" "local config API"
fi

REMAINING_WEB="$(ss -ltnp | grep ":$PORT " || true)"
REMAINING_API="$(ss -ltnp | grep ":$API_PORT " || true)"

if [ -n "$REMAINING_WEB" ] || [ -n "$REMAINING_API" ]; then
  printf 'Warning: some listeners are still active.\n'
  [ -n "$REMAINING_WEB" ] && printf 'Web listener: %s\n' "$REMAINING_WEB"
  [ -n "$REMAINING_API" ] && printf 'API listener: %s\n' "$REMAINING_API"
  exit 1
fi

printf 'Server-backed web mode has been stopped.\n'
