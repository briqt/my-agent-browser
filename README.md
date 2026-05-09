# my-agent-browser

Browser automation for AI agents, powered by [chrome-devtools-mcp](https://github.com/anthropics/chrome-devtools-mcp).

## What is this?

A skill + thin wrapper that lets any AI agent control a Chrome browser via MCP tools. The agent gets native tool calls (`navigate_page`, `take_snapshot`, `click`, `fill`, etc.) instead of parsing CLI output.

## Architecture

```
Agent (Claude Code / Cursor / etc.)
  ↓ MCP tool calls
start-mcp.sh (wrapper)
  ↓ ensures Chrome is running, reads config, exec's:
chrome-devtools-mcp
  ↓ CDP protocol
Chrome (persistent, headless or visible)
```

## Quick Start

```bash
# 1. Clone
git clone https://github.com/briqt/my-agent-browser.git ~/.my-agent-browser

# 2. Create config
cp ~/.my-agent-browser/config.example.json ~/.my-agent-browser/config.json
# Edit as needed (port, proxy, headless, etc.)

# 3. Add MCP server to your agent (Claude Code example)
```

In `~/.claude/settings.json`:
```json
{
  "mcpServers": {
    "browser": {
      "command": "/home/you/.my-agent-browser/scripts/start-mcp.sh"
    }
  }
}
```

## Configuration

`~/.my-agent-browser/config.json`:

```json
{
  "browser": {
    "headless": true,
    "noSandbox": true,
    "cdpPort": 19333,
    "userDataDir": "~/.my-agent-browser/profiles/default/user-data",
    "proxy": "",
    "extraArgs": []
  },
  "mcp": {
    "command": "npx",
    "args": ["-y", "chrome-devtools-mcp@latest"],
    "features": [],
    "flags": []
  }
}
```

## Manual Chrome Control

```bash
./scripts/browser.sh start    # Launch Chrome
./scripts/browser.sh status   # Check if running
./scripts/browser.sh stop     # Stop Chrome
```

## How Agents Use It

Once configured as an MCP server, agents get these tools natively:

1. `navigate_page { url }` — Go to a page
2. `take_snapshot` — See page structure with uid refs
3. `click { uid }` / `fill { uid, value }` — Interact with elements
4. `wait_for { text }` — Wait for content

See [SKILL.md](SKILL.md) for the full workflow guide.
