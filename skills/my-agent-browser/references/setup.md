# Setup

## Prerequisites

- Google Chrome, Chromium, or Microsoft Edge installed
- Node.js 20+ (for npm and the MCP wrapper script)

## Installation

### Step 1: Install the skill

```bash
npx skills add briqt/my-agent-browser -g
```

This installs the skill, including `start-mcp.js` and config template, to `~/.agents/skills/my-agent-browser/`.

### Step 2: Install the runtime dependency

```bash
npm install -g chrome-devtools-mcp@latest
```

### Step 3: Create your personal config

```bash
mkdir -p ~/.my-agent-browser
cp ~/.agents/skills/my-agent-browser/config.example.json ~/.my-agent-browser/config.json
```

### Step 4: Configure your agent's MCP server

Add the browser MCP server to your agent's config:

**Claude Code** (`~/.claude/settings.json`):
```json
{
  "mcpServers": {
    "browser": {
      "command": "node",
      "args": ["~/.agents/skills/my-agent-browser/scripts/start-mcp.js"]
    }
  }
}
```

**Cursor** (`.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "browser": {
      "command": "node",
      "args": ["~/.agents/skills/my-agent-browser/scripts/start-mcp.js"]
    }
  }
}
```

**Windows** — use the full path to node and the script:
```json
{
  "mcpServers": {
    "browser": {
      "command": "node",
      "args": ["C:\\Users\\YOU\\.agents\\skills\\my-agent-browser\\scripts\\start-mcp.js"]
    }
  }
}
```

### Step 5: Verify

Restart your agent session, then ask it to navigate to a page:

```
navigate to https://example.com and take a snapshot
```

If the MCP tools respond, you're set. If you get "tool not found", check that the path in step 4 is correct and that `node ~/.agents/skills/my-agent-browser/scripts/start-mcp.js` runs without error when executed manually.

## Quick Install (optional)

If you prefer a one-step setup, clone the repo and run the install script:

```bash
git clone https://github.com/briqt/my-agent-browser.git ~/.my-agent-browser-repo
cd ~/.my-agent-browser-repo && bash install.sh
```

This does steps 2-4 automatically. You still need step 1 (`npx skills add`) for the skill itself.

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

## Updating

```bash
npx skills update my-agent-browser -g
npm install -g chrome-devtools-mcp@latest
```

## Uninstalling

```bash
npx skills remove my-agent-browser -g
npm uninstall -g chrome-devtools-mcp
rm -rf ~/.my-agent-browser
```
