# Setup

## Prerequisites

- Google Chrome, Chromium, or Microsoft Edge installed
- Node.js 18+ (for npx / npm)
- python3 (for config parsing in wrapper script)

## Installation

```bash
git clone https://github.com/briqt/my-agent-browser.git ~/.my-agent-browser
cd ~/.my-agent-browser && bash install.sh
```

The installer will:
1. Install `chrome-devtools-mcp` globally (eliminates npx startup delay)
2. Create `~/.my-agent-browser/config.json` from the example template
3. Print the MCP server config snippet to add to your agent

## MCP Server Configuration

After running `install.sh`, add the printed config to your agent:

**Claude Code** (`~/.claude/settings.json`):
```json
{
  "mcpServers": {
    "browser": {
      "command": "/home/YOU/.my-agent-browser/scripts/start-mcp.sh"
    }
  }
}
```

**Cursor** (`.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "browser": {
      "command": "/home/YOU/.my-agent-browser/scripts/start-mcp.sh"
    }
  }
}
```

Replace `/home/YOU` with your actual home directory path.

## Installing the Skill

```bash
npx skills add ~/.my-agent-browser/skills/my-agent-browser -g
```

## Configuration

Edit `~/.my-agent-browser/config.json`:

```json
{
  "browser": {
    "userDataDir": "~/.my-agent-browser/user-data",
    "headless": true,
    "proxy": "",
    "viewport": "1280x720",
    "extraArgs": []
  },
  "mcp": {
    "features": [],
    "flags": []
  }
}
```

### Fields

| Field | Description | Default |
|-------|-------------|---------|
| `browser.userDataDir` | Chrome profile directory (cookies/logins persist here) | `~/.my-agent-browser/user-data` |
| `browser.headless` | Run without visible window | `true` |
| `browser.proxy` | HTTP proxy for all browser traffic | `""` (none) |
| `browser.viewport` | Browser window size | `"1280x720"` |
| `browser.extraArgs` | Additional Chrome flags (anti-detection, etc.) | `[]` |
| `mcp.features` | Extra chrome-devtools-mcp feature flags | `[]` |
| `mcp.flags` | Extra chrome-devtools-mcp category flags | `[]` |

### Anti-detection example

```json
{
  "browser": {
    "extraArgs": [
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
      "--disable-dev-shm-usage",
      "--no-sandbox"
    ]
  }
}
```

### Using an existing Chrome profile (e.g., from OpenClaw)

```json
{
  "browser": {
    "userDataDir": "~/.openclaw/browser/openclaw/user-data"
  }
}
```

Note: Chrome locks user-data-dir, so you can't use the same profile simultaneously from two processes.

## Manual Chrome Control

The MCP server manages Chrome automatically. For manual control:

```bash
~/.my-agent-browser/scripts/browser.sh start
~/.my-agent-browser/scripts/browser.sh status
~/.my-agent-browser/scripts/browser.sh stop
```

## Updating

```bash
cd ~/.my-agent-browser && git pull
npm install -g chrome-devtools-mcp@latest
```
