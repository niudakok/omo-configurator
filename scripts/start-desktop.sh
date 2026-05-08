#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v npm >/dev/null 2>&1; then
  printf 'Error: npm is not installed or not in PATH.\n' >&2
  exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
  printf 'Error: cargo is not installed or not in PATH. Tauri desktop mode requires Rust/Cargo.\n' >&2
  exit 1
fi

if [ ! -d "$ROOT_DIR/node_modules" ]; then
  printf 'node_modules not found. Running install first...\n'
  "$ROOT_DIR/scripts/install.sh"
fi

printf 'Starting Tauri desktop mode...\n'
npm run tauri dev --prefix "$ROOT_DIR" -- "$@"
