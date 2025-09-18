#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

log() {
  printf '\n[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1"
}

require_command() {
  local cmd="$1"
  local install_hint="$2"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    printf 'Error: Required command "%s" not found. %s\n' "$cmd" "$install_hint" >&2
    exit 1
  fi
}

compare_semver() {
  # Returns 0 if $1 >= $2, 1 otherwise.
  local current="$1"
  local required="$2"
  local IFS=.
  read -r -a current_parts <<< "${current#v}"
  read -r -a required_parts <<< "${required#v}"
  local length="${#required_parts[@]}"
  for ((i = 0; i < length; i++)); do
    local current_part="${current_parts[i]:-0}"
    local required_part="${required_parts[i]:-0}"
    if ((10#${current_part} > 10#${required_part})); then
      return 0
    elif ((10#${current_part} < 10#${required_part})); then
      return 1
    fi
  done
  return 0
}

require_command "node" "Install Node.js 20 or newer from https://nodejs.org/."
require_command "npm" "Install Node.js 20 or newer from https://nodejs.org/."

NODE_VERSION="$(node --version)"
REQUIRED_NODE="20.0.0"
if ! compare_semver "$NODE_VERSION" "$REQUIRED_NODE"; then
  printf 'Error: Detected Node.js %s. Please install Node.js %s or newer.\n' "$NODE_VERSION" "$REQUIRED_NODE" >&2
  exit 1
fi

log "Installing npm dependencies"
if [ -d node_modules ]; then
  log "Existing node_modules detected – running npm install"
  npm install --no-fund --no-audit
else
  log "No node_modules directory found – running npm ci"
  npm ci --no-fund --no-audit
fi

log "Building development bundle"
npm run build:dev

log "Build complete. Load ./build/unpacked into your browser in developer mode to test the extension."
