# my-agent-browser

Browser automation for AI agents, powered by [chrome-devtools-mcp](https://github.com/anthropics/chrome-devtools-mcp).

## What is this?

A thin config-driven wrapper that gives AI agents native MCP tool calls for browser control (`navigate_page`, `take_snapshot`, `click`, `fill`, etc.). No custom runtime code — just orchestration of `chrome-devtools-mcp`.

## Install

```bash
npx skills add briqt/my-agent-browser -g
npm install -g chrome-devtools-mcp@^0.25.0
mkdir -p ~/.my-agent-browser
cp <skill-dir>/config.example.json ~/.my-agent-browser/config.json
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
  ↓ reads ~/.my-agent-browser/config.json, builds args, spawns:
chrome-devtools-mcp
  ↓ launches & controls Chrome via CDP
Chrome
```

- Chrome is launched by `chrome-devtools-mcp` on demand (not pre-started)
- All browser settings (proxy, anti-detection, profile) live in `~/.my-agent-browser/config.json`
- Config changes take effect on next agent session

## Project structure

```
├── skills/my-agent-browser/     # Skill package (installed via npx skills add)
│   ├── SKILL.md                 # Agent workflow guide
│   ├── scripts/
│   │   └── start-mcp.js        # MCP server wrapper (cross-platform Node.js)
│   ├── config.example.json      # Config template
│   └── references/
│       ├── setup.md                    # Installation & configuration
│       ├── troubleshooting.md          # Common issues & fixes
│       ├── advanced-tools.md           # Performance, Lighthouse, Console, Emulation
│       ├── network-debugging.md        # Network request inspection workflows
│       ├── scraping-patterns.md        # Data extraction best practices
│       ├── multi-tab-workflow.md       # Multi-tab management patterns
│       └── javascript-execution.md    # evaluate_script advanced usage
├── install.sh                   # Optional one-step installer
└── README.md
```

## Updating

```bash
npx skills update my-agent-browser -g
npm install -g chrome-devtools-mcp@^0.25.0
```
