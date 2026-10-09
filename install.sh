#!/usr/bin/env bash
set -euo pipefail

REPO_TARBALL_URL="https://github.com/render-oss/render-opencode-plugin/archive/refs/heads/main.tar.gz"
SOURCE_DIR=""
SETUP_ARGS=(setup --include-plugin)

usage() {
  cat <<'HELP'
Install or upgrade the Render OpenCode plugin from GitHub.
Requires Node.js 18+ or Bun.

Usage: install.sh [options]

  --config-dir <path>  Target OpenCode config directory; defaults to OpenCode's XDG location.
  --source <path>      Use a local repo checkout instead of downloading from GitHub.
  --enable-mcp        Add Render MCP config, preserving an existing entry unless forced.
  --force             Overwrite user-modified files and existing Render MCP config.
  --dry-run           Preview writes and removals without changing files.
  -h, --help          Show this help.

Unmodified bundled files update automatically. Modified files are preserved.
HELP
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source|--config-dir)
      if [[ $# -lt 2 || -z "$2" || "$2" == --* ]]; then
        echo "$1 requires a path." >&2
        exit 1
      fi
      if [[ "$1" == "--source" ]]; then SOURCE_DIR="$2"; else SETUP_ARGS+=("$1" "$2"); fi
      shift 2
      ;;
    --force|--enable-mcp|--dry-run) SETUP_ARGS+=("$1"); shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

if command -v node >/dev/null 2>&1; then
  RUNTIME="node"
elif command -v bun >/dev/null 2>&1; then
  RUNTIME="bun"
else
  echo "Install requires Node.js 18+ or Bun for the shared asset installer." >&2
  exit 1
fi

INSTALL_TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$INSTALL_TMP_DIR"' EXIT

if [[ -z "$SOURCE_DIR" ]]; then
  ARCHIVE="$INSTALL_TMP_DIR/render-opencode-plugin.tar.gz"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$REPO_TARBALL_URL" -o "$ARCHIVE"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$ARCHIVE" "$REPO_TARBALL_URL"
  else
    echo "Install requires curl or wget." >&2
    exit 1
  fi
  tar -xzf "$ARCHIVE" -C "$INSTALL_TMP_DIR"
  SOURCE_DIR="$(find "$INSTALL_TMP_DIR" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
fi

if [[ ! -f "$SOURCE_DIR/assets/setup.mjs" || ! -d "$SOURCE_DIR/assets/opencode" ]]; then
  echo "Could not find the Render installer and assets in $SOURCE_DIR." >&2
  exit 1
fi

"$RUNTIME" "$SOURCE_DIR/assets/setup.mjs" "${SETUP_ARGS[@]}"
echo "Restart OpenCode to load installed plugin, skills, commands, and agents."
