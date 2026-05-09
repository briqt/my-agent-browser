#!/usr/bin/env bash
# MCP server wrapper for chrome-devtools-mcp.
# Reads ~/.my-agent-browser/config.json, builds args, exec's chrome-devtools-mcp.
# Chrome is launched by chrome-devtools-mcp itself (--userDataDir mode) — no pre-start needed.
set -euo pipefail

CONFIG_DIR="${MY_AGENT_BROWSER_HOME:-$HOME/.my-agent-browser}"
CONFIG_FILE="$CONFIG_DIR/config.json"

# --- Read config via python3 (single call for all values) ---

read_config() {
  python3 -c "
import json, os, sys

config_path = '$CONFIG_FILE'
if not os.path.isfile(config_path):
    sys.exit(0)

d = json.load(open(config_path))
b = d.get('browser', {})
m = d.get('mcp', {})

# Browser settings → chrome-devtools-mcp flags
user_data_dir = b.get('userDataDir', '')
if user_data_dir:
    user_data_dir = os.path.expanduser(user_data_dir)
    print(f'--userDataDir={user_data_dir}')

if b.get('headless'):
    print('--headless')

proxy = b.get('proxy', '')
if proxy:
    print(f'--proxyServer={proxy}')

viewport = b.get('viewport', '')
if viewport:
    print(f'--viewport={viewport}')

# Extra Chrome args (anti-detection, etc.)
for arg in b.get('extraArgs', []):
    print(f'--chromeArg={arg}')

# MCP features and flags
for f in m.get('features', []):
    print(f)

for f in m.get('flags', []):
    print(f)
" 2>/dev/null || true
}

# --- Build args ---

ARGS=()

while IFS= read -r line; do
  [[ -n "$line" ]] && ARGS+=("$line")
done < <(read_config)

# --- Resolve command ---

MCP_BIN="chrome-devtools-mcp"

if command -v "$MCP_BIN" &>/dev/null; then
  exec "$MCP_BIN" "${ARGS[@]}"
else
  exec npx -y chrome-devtools-mcp@latest "${ARGS[@]}"
fi
