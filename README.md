# my-agent-browser

[![Platform](https://img.shields.io/badge/Platform-Linux%20%7C%20macOS%20%7C%20Windows-blue)]()

Production-ready wrapper around [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp). chrome-devtools-mcp provides the browser MCP tools, but leaves Chrome process management, multi-session sharing, and fault recovery entirely to you. This project adds the operational layer so AI agents can use the browser reliably.

**[中文文档](README_CN.md)**

## What this adds over bare chrome-devtools-mcp

### Chrome Lifecycle Management

- Auto-find Chrome on your system (macOS/Linux/Windows, searches 10+ paths including Edge/Brave/Arc/Chromium)
- Lazy start — Chrome only launches on first `tools/call`, not at agent startup
- Multiple agent sessions share one Chrome instance via `browser.lock` reference counting
- Last session to exit automatically closes Chrome
- No orphans after agent crash: parent heartbeat detection + startup orphan process cleanup
- WSL / headless Linux: auto-detect and configure DISPLAY (WSLg, Wayland, X11)

### Fault Recovery

- Chrome crash detection via CDP port probe — never trusts error text alone
- Confirmed crash → auto-relaunch Chrome, rewrite MCP response to tell agent to re-navigate
- MCP stale state (referencing closed tab) → restart only the MCP child process, Chrome stays
- Profile lock leftover (SingletonLock after hard kill) → auto-clean before launch

### Config-driven + Anti-detection

- Headless mode, proxy, viewport size, custom launch args — all Chrome startup flags configurable
- Pass any Chrome flags via `extraArgs` to reduce automation detection risk (e.g. `--disable-blink-features=AutomationControlled`)
- Direct connection to existing Chrome (`browserUrl` mode, for pre-authenticated long-lived sessions)

### Agent Workflow Guidance (SKILL.md)

- Heavy pages: file-based snapshots to prevent DOM overflow crashes
- Error recovery: stale UIDs, timeouts, Chrome restart — correct response for each
- Multi-tab: open/extract/close pattern, UID isolation between tabs
- Scraping: URL-based pagination, lazy-load triggering, JS extraction
- Login flows: persistent profile, automated credentials, connect to existing session

## Install

```bash
npx skills add briqt/my-agent-browser -g -y
npm install -g chrome-devtools-mcp@^1.3.0
mkdir -p ~/.config/agent-skills/my-agent-browser
cp ~/.agents/skills/my-agent-browser/config.example.json ~/.config/agent-skills/my-agent-browser/config.json
```

Then register the MCP server in your agent:

### Claude Code

```bash
claude mcp add browser -s user -- node ~/.agents/skills/my-agent-browser/scripts/start-mcp.js
```

Or add to your project's `.mcp.json`:

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

### Codex

```bash
codex mcp add browser -- node ~/.agents/skills/my-agent-browser/scripts/start-mcp.js
```

Or add to `~/.codex/config.toml`:

```toml
[mcp_servers.browser]
command = "node"
args = ["~/.agents/skills/my-agent-browser/scripts/start-mcp.js"]
enabled = true
```

### Other MCP agents (Cursor, Kiro, etc.)

Add the MCP server entry per your agent's documentation:
- Command: `node`
- Args: `["~/.agents/skills/my-agent-browser/scripts/start-mcp.js"]`

## How it works

```
Agent (Claude Code / Codex / Cursor / Kiro / etc.)
  ↓ MCP tool calls (native)
start-mcp.js
  ↓ reads config, manages Chrome lifecycle via browser.lock
  ↓ launches Chrome (detached) with --remote-debugging-port
  ↓ spawns chrome-devtools-mcp with --browserUrl to connect
chrome-devtools-mcp
  ↓ controls Chrome via CDP
Chrome (shared across sessions)
```

- Chrome runs as a detached process, shared by multiple MCP sessions
- `browser.lock` tracks active client count; last client to exit kills Chrome
- All browser settings live in `~/.config/agent-skills/my-agent-browser/config.json`
- Config changes take effect on next agent session

## What the SKILL.md teaches agents

The bundled SKILL.md provides workflow guidance so agents avoid common pitfalls:

- **Heavy pages** — file-based snapshots to prevent DOM overflow crashes
- **Scraping patterns** — URL-based pagination, lazy-load triggering, JS extraction
- **Multi-tab** — open/extract/close pattern, UID isolation between tabs
- **Error recovery** — stale UIDs, timeouts, Chrome restarts
- **Login flows** — persistent profiles, automated credentials, existing sessions

## Project structure

```
├── skills/my-agent-browser/
│   ├── SKILL.md                 # Agent workflow guide
│   ├── scripts/
│   │   └── start-mcp.js        # MCP server wrapper
│   ├── config.example.json      # Config template
│   ├── config.schema.json       # JSON Schema for config validation
│   └── references/
│       ├── setup.md             # Installation & configuration
│       ├── troubleshooting.md   # Common issues & fixes
│       ├── advanced-tools.md    # Performance, Lighthouse, Console, Emulation
│       ├── network-debugging.md # Network request inspection
│       ├── scraping-patterns.md # Data extraction patterns
│       ├── multi-tab-workflow.md
│       └── javascript-execution.md
├── README.md
└── README_CN.md
```

## Updating

```bash
npx skills update my-agent-browser -g -y
npm install -g chrome-devtools-mcp@^1.3.0
```

## Community

Shared on [LINUX DO](https://linux.do/t/topic/2451355)
