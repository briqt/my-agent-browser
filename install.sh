#!/usr/bin/env bash
# Optional convenience script — does steps 2-4 of the setup in one go.
# Step 1 (npx skills add briqt/my-agent-browser -g) must be done separately.
set -euo pipefail

CONFIG_DIR="${MY_AGENT_BROWSER_HOME:-$HOME/.my-agent-browser}"
SKILL_DIR="$HOME/.agents/skills/my-agent-browser"

echo "my-agent-browser — quick setup"
echo ""

# 1. Install chrome-devtools-mcp globally
echo "  → Installing chrome-devtools-mcp..."
npm install -g chrome-devtools-mcp@latest 2>/dev/null || {
  echo "  ⚠ Global npm install failed. Will fall back to npx (slower startup)."
}

# 2. Create config
mkdir -p "$CONFIG_DIR"

if [[ ! -f "$CONFIG_DIR/config.json" ]]; then
  # Prefer the skill-bundled template; fall back to repo-local copy
  if [[ -f "$SKILL_DIR/config.example.json" ]]; then
    cp "$SKILL_DIR/config.example.json" "$CONFIG_DIR/config.json"
  elif [[ -f "$(dirname "${BASH_SOURCE[0]}")/config.example.json" ]]; then
    cp "$(dirname "${BASH_SOURCE[0]}")/config.example.json" "$CONFIG_DIR/config.json"
  fi
  echo "  → Created $CONFIG_DIR/config.json"
else
  echo "  → Config already exists: $CONFIG_DIR/config.json"
fi

# 3. Ensure start-mcp.sh is executable
if [[ -f "$SKILL_DIR/scripts/start-mcp.sh" ]]; then
  chmod +x "$SKILL_DIR/scripts/start-mcp.sh"
fi

# 4. Print MCP server config
SCRIPT_PATH="$SKILL_DIR/scripts/start-mcp.sh"

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
echo "Config: $CONFIG_DIR/config.json"
echo "Edit it to set proxy, extraArgs (anti-detection), headless mode, etc."
