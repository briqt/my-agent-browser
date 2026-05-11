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
| `browser.browserUrl` | Connect to an existing Chrome instance (e.g., `http://127.0.0.1:9222`) | `""` (launch new) |
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

### Understanding `mcp.features` vs `mcp.flags`

The `mcp` section of config.json has two arrays that serve different purposes:

- **`flags`** — Category toggles that enable entire groups of tools. Each flag
  unlocks a set of related MCP tools that the agent can call. Without the flag,
  those tools are hidden from the agent entirely. Example: `--categoryNetwork`
  enables `list_network_requests` and `get_network_request`.

- **`features`** — Individual feature flags that change chrome-devtools-mcp's
  behavior or output format. These don't add new tools; they modify how existing
  tools work. Example: `--vision` makes `take_snapshot` return a screenshot
  image instead of an accessibility-tree text representation.

In short: `flags` control *which tools are available*, `features` control *how
tools behave*.

### Full mode (performance, network, lighthouse)

By default, only core browser automation tools are available. To unlock advanced capabilities, add category flags to `mcp.flags`:

```json
{
  "mcp": {
    "flags": [
      "--categoryPerformance",
      "--categoryNetwork",
      "--categoryLighthouse",
      "--categoryConsole",
      "--categoryEmulation"
    ]
  }
}
```

Available categories:

| Flag | Tools unlocked |
|------|---------------|
| `--categoryPerformance` | `performance_start_trace`, `performance_stop_trace`, `performance_analyze_insight`, `take_memory_snapshot` |
| `--categoryNetwork` | `list_network_requests`, `get_network_request` |
| `--categoryLighthouse` | `lighthouse_audit` (navigation and snapshot modes) |
| `--categoryConsole` | `list_console_messages`, `get_console_message` |
| `--categoryEmulation` | `emulate` (network conditions, CPU throttling, geolocation, color scheme, user agent) |
| `--categoryExtensions` | `list_extensions`, `install_extension`, `uninstall_extension`, `reload_extension` |

You can enable all categories at once or pick only what you need. More categories = more tools exposed to the agent = slightly longer tool list in context.

### Connecting to an existing Chrome instance

If you need to connect to a Chrome that's already running (e.g., in Docker, a remote machine, or to preserve login state across sessions):

1. Start Chrome with remote debugging enabled:
   ```bash
   google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-profile
   ```

2. Set `browserUrl` in config:
   ```json
   {
     "browser": {
       "browserUrl": "http://127.0.0.1:9222"
     }
   }
   ```

When `browserUrl` is set, chrome-devtools-mcp connects to the existing instance instead of launching a new one. The `headless`, `userDataDir`, and `extraArgs` fields are ignored in this mode (they only apply when launching Chrome).

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
