# my-agent-browser

[![Platform](https://img.shields.io/badge/Platform-Linux%20%7C%20macOS%20%7C%20Windows-blue)]()

Browser automation skill for AI agents, powered by [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp).

Give your AI agent full browser control — navigate pages, fill forms, click buttons, scrape data, run Lighthouse audits — via native MCP tool calls. One command to install, zero custom runtime code.

**[中文文档](README_CN.md)**

## Features

- **Native MCP browser tools** — `navigate_page`, `take_snapshot`, `click`, `fill`, `evaluate_script`, and 20+ more
- **Chrome lifecycle management** — shared instance across sessions, reference counting, auto-cleanup
- **Built-in SKILL.md** — teaches agents correct usage patterns (heavy page handling, error recovery, multi-tab)
- **One-line install** — works with Claude Code, Codex, Cursor, Kiro, and any MCP-capable agent
- **Crash recovery** — CDP port probing before concluding Chrome is dead, auto-relaunch when needed
- **Cross-platform** — macOS, Linux, Windows

## Install

```bash
npx skills add briqt/my-agent-browser -g
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
npx skills update my-agent-browser -g
npm install -g chrome-devtools-mcp@^1.3.0
```

## Community

Shared on [LINUX DO](https://linux.do/)
