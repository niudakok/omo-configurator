#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT=1420

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

LISTENER="$(ss -ltnp | grep ":$PORT " || true)"
if [ -n "$LISTENER" ]; then
  printf 'Browser mode is already running on port %s.\n' "$PORT"
  printf 'Open: http://localhost:%s/\n' "$PORT"
  printf 'Listener: %s\n' "$LISTENER"
  exit 0
fi

printf 'Starting browser mode...\n'
npm run dev:browser --prefix "$ROOT_DIR" -- "$@"
