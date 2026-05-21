# Setup

## Prerequisites

- Google Chrome, Chromium, or Microsoft Edge installed
- Node.js 20+ (for npm and the MCP wrapper script)

## Path Convention

Throughout this document, `<skill-dir>` refers to the directory containing SKILL.md. The actual path depends on your agent and installation scope:

| Agent | Typical path |
|-------|-------------|
| Claude Code (global) | `~/.agents/skills/my-agent-browser/` |
| Claude Code (project) | `.claude/skills/my-agent-browser/` |
| Cursor | `~/.agents/skills/my-agent-browser/` |
| Kiro | `~/.agents/skills/my-agent-browser/` |

## Installation

### Step 1: Install the skill

```bash
npx skills add briqt/my-agent-browser -g
```

This installs the skill (SKILL.md, scripts, references) to `<skill-dir>`.

### Step 2: Install the runtime dependency

```bash
npm install -g chrome-devtools-mcp@^0.25.0
```

### Step 3: Create your personal config

```bash
mkdir -p ~/.config/agent-skills/my-agent-browser
cp <skill-dir>/config.example.json ~/.config/agent-skills/my-agent-browser/config.json
```

### Step 4: Register the MCP server in your agent/IDE

Add the browser MCP server to your agent's MCP configuration. The entry you need:

- **Name**: `browser`
- **Command**: `node`
- **Args**: `["<skill-dir>/scripts/start-mcp.js"]` (resolve `<skill-dir>` to the actual absolute path on your system)

How to register depends on your environment. Consult your agent's `/help` command, official documentation, or settings UI to find where MCP servers are configured. The JSON structure is typically:

```json
{
  "mcpServers": {
    "browser": {
      "command": "node",
      "args": ["/absolute/path/to/skills/my-agent-browser/scripts/start-mcp.js"]
    }
  }
}
```

On Windows, use backslashes or double-escaped forward slashes in the path.

### Step 5: Verify

Restart your agent session, then ask it to navigate to a page:

```
navigate to https://example.com and take a snapshot
```

If the MCP tools respond, you're set. If you get "tool not found", check that the path in step 4 is correct and that `node ~/.agents/skills/my-agent-browser/scripts/start-mcp.js` runs without error when executed manually.

## Configuration

Edit `~/.config/agent-skills/my-agent-browser/config.json`:

```json
{
  "browser": {
    "userDataDir": "~/.config/agent-skills/my-agent-browser/user-data",
    "headless": true,
    "proxy": "",
    "viewport": "1280x720",
    "debuggingPort": 39813,
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
| `browser.userDataDir` | Chrome profile directory (cookies/logins persist here) | `~/.config/agent-skills/my-agent-browser/user-data` |
| `browser.headless` | Run without visible window (`true` for servers/CI, `false` to watch the browser) | `true` |
| `browser.lazyStart` | Delay Chrome launch until the first tool call (saves resources if browser isn't always needed) | `true` |
| `browser.proxy` | HTTP proxy for all browser traffic. Leave empty to use no proxy. Agent can check environment variables (`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`) to detect if a proxy is configured in the system and set this accordingly | `""` (none) |
| `browser.viewport` | Browser window size as `WIDTHxHEIGHT` | `"1280x720"` |
| `browser.debuggingPort` | Chrome remote debugging port | `39813` |
| `browser.browserUrl` | Connect to an existing Chrome instance instead of launching one (e.g. `http://127.0.0.1:9222`). When set, `headless`/`userDataDir`/`extraArgs` are ignored | `""` (launch new) |
| `browser.extraArgs` | Additional Chrome command-line flags (see below) | `[]` |
| `mcp.features` | Feature flags that change tool behavior (e.g. `--vision`) | `[]` |
| `mcp.flags` | Category flags that unlock additional tool groups (e.g. `--categoryNetwork`) | `[]` |

### Common `extraArgs` flags

These are Chrome command-line switches you can add to `browser.extraArgs`. Pick what you need:

| Flag | Effect |
|------|--------|
| `--disable-blink-features=AutomationControlled` | Hide the `navigator.webdriver` property so sites don't detect automation |
| `--disable-infobars` | Suppress "Chrome is being controlled by automated software" bar |
| `--disable-dev-shm-usage` | Use `/tmp` instead of `/dev/shm` for shared memory (fixes crashes in Docker/low-memory) |
| `--disable-gpu` | Disable GPU hardware acceleration (useful for headless or environments without GPU) |
| `--no-first-run` | Skip Chrome's first-run experience and welcome page |
| `--disable-background-networking` | Prevent background network requests (update checks, safe browsing, etc.) |
| `--disable-sync` | Disable Chrome account sync |
| `--disable-translate` | Disable the built-in translation prompt |
| `--metrics-recording-only` | Disable reporting of metrics (still records internally) |
| `--mute-audio` | Mute all audio output |
| `--hide-scrollbars` | Hide scrollbars (cleaner screenshots) |
| `--disable-hang-monitor` | Disable "page unresponsive" dialogs |
| `--disable-prompt-on-repost` | Disable "confirm form resubmission" dialogs |
| `--disable-client-side-phishing-detection` | Disable phishing detection (avoids network calls) |
| `--disable-component-update` | Disable component (Widevine, etc.) auto-updates |
| `--disable-domain-reliability` | Disable domain reliability monitoring (no telemetry pings) |
| `--disable-features=TranslateUI` | Disable the translate UI bubble |
| `--enable-automation=false` | Prevent setting `navigator.webdriver=true` |
| `--no-sandbox` | Disable sandbox (required in some Docker/CI environments, reduces security) |
| `--proxy-server=HOST:PORT` | Route traffic through a proxy (alternative to the `proxy` field) |
| `--user-agent=STRING` | Override the default User-Agent string. Leave unset to use Chrome's default UA |

A recommended set for automation that avoids bot detection and reduces noise:

```json
{
  "browser": {
    "extraArgs": [
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-background-networking",
      "--disable-sync",
      "--disable-translate",
      "--metrics-recording-only",
      "--mute-audio",
      "--disable-hang-monitor",
      "--disable-prompt-on-repost",
      "--disable-client-side-phishing-detection",
      "--disable-component-update",
      "--disable-domain-reliability",
      "--disable-features=TranslateUI",
      "--enable-automation=false"
    ]
  }
}
```

To override the User-Agent, add `--user-agent=STRING` to `extraArgs`:

```json
{
  "browser": {
    "extraArgs": ["--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ..."]
  }
}
```

Leave it unset to use Chrome's built-in default, which is usually sufficient.

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
rm -rf ~/.config/agent-skills/my-agent-browser
```
