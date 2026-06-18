# my-agent-browser

Browser automation for AI agents, powered by [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp).

## What is this?

A thin config-driven wrapper that gives AI agents native MCP tool calls for browser control (`navigate_page`, `take_snapshot`, `click`, `fill`, etc.). No custom runtime code — just orchestration of `chrome-devtools-mcp`.

## Install

```bash
npx skills add briqt/my-agent-browser -g
npm install -g chrome-devtools-mcp@^1.3.0
mkdir -p ~/.config/agent-skills/my-agent-browser
cp <skill-dir>/config.example.json ~/.config/agent-skills/my-agent-browser/config.json
```

`<skill-dir>` is where the skill was installed (typically `~/.agents/skills/my-agent-browser/`).

Then add the MCP server to your agent's config (Claude Code example):

```json
{
  "mcpServers": {
    "browser": {
      "command": "node",
      "args": ["<skill-dir>/scripts/start-mcp.js"]
    }
  }
}
```

See [skills/my-agent-browser/references/setup.md](skills/my-agent-browser/references/setup.md) for full setup details.

## How it works

```
Agent (Claude Code / Cursor / Kiro / etc.)
  ↓ MCP tool calls (native)
start-mcp.js
  ↓ reads config, manages Chrome lifecycle via browser.lock
  ↓ launches Chrome (detached) with --remote-debugging-port if not running
  ↓ spawns chrome-devtools-mcp with --browserUrl to connect
chrome-devtools-mcp
  ↓ controls Chrome via CDP
Chrome (shared across sessions)
```

- Chrome runs as a detached process, shared by multiple MCP sessions
- `browser.lock` tracks active client count; last client to exit kills Chrome
- All browser settings live in `~/.config/agent-skills/my-agent-browser/config.json`
- Config changes take effect on next agent session

## Project structure

```
├── skills/my-agent-browser/     # Skill package (installed via npx skills add)
│   ├── SKILL.md                 # Agent workflow guide
│   ├── scripts/
│   │   └── start-mcp.js        # MCP server wrapper (cross-platform Node.js)
│   ├── config.example.json      # Config template
│   ├── config.schema.json       # JSON Schema for config validation
│   └── references/
│       ├── setup.md                    # Installation & configuration
│       ├── troubleshooting.md          # Common issues & fixes
│       ├── advanced-tools.md           # Performance, Lighthouse, Console, Emulation
│       ├── network-debugging.md        # Network request inspection workflows
│       ├── scraping-patterns.md        # Data extraction best practices
│       ├── multi-tab-workflow.md       # Multi-tab management patterns
│       └── javascript-execution.md    # evaluate_script advanced usage
└── README.md
```

## Updating

```bash
npx skills update my-agent-browser -g
npm install -g chrome-devtools-mcp@^1.3.0
```
