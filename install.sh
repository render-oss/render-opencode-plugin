#!/usr/bin/env bash
set -euo pipefail

REPO_TARBALL_URL="https://github.com/render-oss/render-opencode-plugin/archive/refs/heads/main.tar.gz"
CONFIG_DIR="${OPENCODE_CONFIG_DIR:-${HOME:-}/.config/opencode}"
SOURCE_DIR=""
FORCE="0"
DRY_RUN="0"
ENABLE_MCP="0"

usage() {
  cat <<'EOF'
Install the Render OpenCode plugin from GitHub.

Usage:
  install.sh [options]

Options:
  --config-dir <path>  Target OpenCode config directory. Defaults to ~/.config/opencode.
  --source <path>      Use a local repo checkout instead of downloading from GitHub.
  --enable-mcp        Add the Render MCP server to opencode.json.
  --force             Overwrite existing files.
  --dry-run           Print what would change without writing files.
  -h, --help          Show this help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config-dir)
      CONFIG_DIR="$2"
      shift 2
      ;;
    --source)
      SOURCE_DIR="$2"
      shift 2
      ;;
    --force)
      FORCE="1"
      shift
      ;;
    --enable-mcp)
      ENABLE_MCP="1"
      shift
      ;;
    --dry-run)
      DRY_RUN="1"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$CONFIG_DIR" || "$CONFIG_DIR" == "/.config/opencode" ]]; then
  echo "Cannot determine OpenCode config directory. Set HOME or pass --config-dir." >&2
  exit 1
fi

TMPDIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMPDIR"
}
trap cleanup EXIT

if [[ -z "$SOURCE_DIR" ]]; then
  ARCHIVE="$TMPDIR/render-opencode-plugin.tar.gz"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$REPO_TARBALL_URL" -o "$ARCHIVE"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$ARCHIVE" "$REPO_TARBALL_URL"
  else
    echo "Install requires curl or wget." >&2
    exit 1
  fi

  tar -xzf "$ARCHIVE" -C "$TMPDIR"
  SOURCE_DIR="$(find "$TMPDIR" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
fi

ASSETS_DIR="$SOURCE_DIR/assets/opencode"
if [[ ! -d "$ASSETS_DIR" ]]; then
  echo "Could not find assets/opencode in $SOURCE_DIR." >&2
  exit 1
fi

install_file() {
  local src="$1"
  local dest="$2"

  if [[ -e "$dest" && "$FORCE" != "1" ]]; then
    echo "skipped existing $dest"
    return
  fi

  if [[ "$DRY_RUN" == "1" ]]; then
    echo "would write $dest"
    return
  fi

  mkdir -p "$(dirname "$dest")"
  cp "$src" "$dest"
  echo "wrote $dest"
}

for dir in plugins skills commands agents; do
  [[ -d "$ASSETS_DIR/$dir" ]] || continue
  while IFS= read -r -d '' src; do
    rel="${src#"$ASSETS_DIR/$dir/"}"
    install_file "$src" "$CONFIG_DIR/$dir/$rel"
  done < <(find "$ASSETS_DIR/$dir" -type f -print0)
done

install_mcp_config() {
  local config_path="$CONFIG_DIR/opencode.json"

  if ! command -v python3 >/dev/null 2>&1; then
    echo "Cannot enable MCP because python3 is not installed." >&2
    exit 1
  fi

  if [[ "$DRY_RUN" == "1" ]]; then
    echo "would merge Render MCP server into $config_path"
    return
  fi

  mkdir -p "$CONFIG_DIR"

  CONFIG_PATH="$config_path" FORCE="$FORCE" python3 <<'PY'
import json
import os
from pathlib import Path

config_path = Path(os.environ["CONFIG_PATH"])
force = os.environ.get("FORCE") == "1"

if config_path.exists() and config_path.read_text().strip():
    config = json.loads(config_path.read_text())
else:
    config = {"$schema": "https://opencode.ai/config.json"}

if not isinstance(config, dict):
    raise SystemExit(f"{config_path} must contain a JSON object.")

mcp = config.setdefault("mcp", {})
if not isinstance(mcp, dict):
    raise SystemExit(f"{config_path} has a non-object mcp field.")

if "render" in mcp and not force:
    print(f"skipped existing Render MCP config in {config_path}")
    raise SystemExit(0)

mcp["render"] = {
    "type": "remote",
    "url": "https://mcp.render.com/mcp",
    "enabled": True,
    "oauth": False,
    "headers": {
        "Authorization": "Bearer {env:RENDER_API_KEY}",
    },
}

config_path.write_text(json.dumps(config, indent=2) + "\n")
print(f"merged Render MCP server into {config_path}")
PY
}

if [[ "$ENABLE_MCP" == "1" ]]; then
  install_mcp_config
fi

cat <<EOF

Render OpenCode files installed.

$(if [[ "$ENABLE_MCP" == "1" ]]; then echo "Set RENDER_API_KEY before using Render MCP."; fi)

Restart OpenCode so it can load new plugins, skills, commands, and agents.
EOF
