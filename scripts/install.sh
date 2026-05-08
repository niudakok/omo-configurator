#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v npm >/dev/null 2>&1; then
  printf 'Error: npm is not installed or not in PATH.\n' >&2
  exit 1
fi

printf 'Installing npm dependencies in %s\n' "$ROOT_DIR"
npm install --prefix "$ROOT_DIR"
