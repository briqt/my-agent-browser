#!/usr/bin/env bash
# Wrapper that ensures Chrome is running, then exec's chrome-devtools-mcp
# with the correct args from config. Use as MCP server command.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="${MY_AGENT_BROWSER_HOME:-$HOME/.my-agent-browser}"
CONFIG_FILE="$CONFIG_DIR/config.json"

# Ensure Chrome is running and get port
PORT="$("$SCRIPT_DIR/browser.sh" ensure 2>/dev/null)"
if [[ -z "$PORT" ]]; then
  echo "Failed to start Chrome" >&2
  exit 1
fi

# Build chrome-devtools-mcp args from config
ARGS=("--browserUrl" "http://127.0.0.1:${PORT}")

# Read MCP-specific config
if [[ -f "$CONFIG_FILE" ]]; then
  # Extra MCP features from config
  while IFS= read -r feat; do
    [[ -n "$feat" ]] && ARGS+=("$feat")
  done < <(python3 -c "
import json, sys
try:
    d = json.load(open('$CONFIG_FILE'))
    for f in d.get('mcp', {}).get('features', []):
        print(f)
except: pass
" 2>/dev/null)

  # Category flags
  while IFS= read -r flag; do
    [[ -n "$flag" ]] && ARGS+=("$flag")
  done < <(python3 -c "
import json, sys
try:
    d = json.load(open('$CONFIG_FILE'))
    for f in d.get('mcp', {}).get('flags', []):
        print(f)
except: pass
" 2>/dev/null)
fi

# Default features if none configured
if ! printf '%s\n' "${ARGS[@]}" | grep -q "experimentalStructuredContent"; then
  ARGS+=("--experimentalStructuredContent")
fi

# Resolve chrome-devtools-mcp command
MCP_CMD="npx"
MCP_PKG_ARGS=("-y" "chrome-devtools-mcp@latest")

if [[ -f "$CONFIG_FILE" ]]; then
  custom_cmd="$(python3 -c "import json; print(json.load(open('$CONFIG_FILE')).get('mcp',{}).get('command',''))" 2>/dev/null || echo "")"
  [[ -n "$custom_cmd" ]] && MCP_CMD="$custom_cmd"

  custom_pkg="$(python3 -c "import json; import sys; args=json.load(open('$CONFIG_FILE')).get('mcp',{}).get('args',[]); [print(a) for a in args]" 2>/dev/null || echo "")"
  if [[ -n "$custom_pkg" ]]; then
    MCP_PKG_ARGS=()
    while IFS= read -r arg; do
      [[ -n "$arg" ]] && MCP_PKG_ARGS+=("$arg")
    done <<< "$custom_pkg"
  fi
fi

exec "$MCP_CMD" "${MCP_PKG_ARGS[@]}" "${ARGS[@]}"
