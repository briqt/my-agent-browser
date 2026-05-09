#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${MY_AGENT_BROWSER_HOME:-$HOME/.my-agent-browser}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Installing my-agent-browser..."

# 1. Install chrome-devtools-mcp globally (eliminates npx startup delay)
echo "  → Installing chrome-devtools-mcp..."
npm install -g chrome-devtools-mcp@latest 2>/dev/null || {
  echo "  ⚠ Global npm install failed. Will fall back to npx (slower)."
}

# 2. Create config directory
mkdir -p "$INSTALL_DIR"

# 3. Copy example config if no config exists
if [[ ! -f "$INSTALL_DIR/config.json" ]]; then
  cp "$REPO_DIR/config.example.json" "$INSTALL_DIR/config.json"
  echo "  → Created $INSTALL_DIR/config.json"
else
  echo "  → Config already exists: $INSTALL_DIR/config.json"
fi

# 4. Make scripts executable
chmod +x "$REPO_DIR/scripts/"*.sh

# 5. Print MCP server config for the user to add
SCRIPT_PATH="$REPO_DIR/scripts/start-mcp.sh"

echo ""
echo "Done! Add this to your agent's MCP server config:"
echo ""
echo "  Claude Code (~/.claude/settings.json):"
echo "    \"mcpServers\": {"
echo "      \"browser\": {"
echo "        \"command\": \"$SCRIPT_PATH\""
echo "      }"
echo "    }"
echo ""
echo "  Cursor (.cursor/mcp.json):"
echo "    \"mcpServers\": {"
echo "      \"browser\": {"
echo "        \"command\": \"$SCRIPT_PATH\""
echo "      }"
echo "    }"
echo ""
echo "Config: $INSTALL_DIR/config.json"
echo "Edit it to set proxy, extraArgs (anti-detection), headless mode, etc."
