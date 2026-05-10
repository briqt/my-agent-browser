# my-agent-browser

Browser automation for AI agents, powered by [chrome-devtools-mcp](https://github.com/anthropics/chrome-devtools-mcp).

## What is this?

A thin config-driven wrapper that gives AI agents native MCP tool calls for browser control (`navigate_page`, `take_snapshot`, `click`, `fill`, etc.). No custom runtime code — just orchestration of `chrome-devtools-mcp`.

## Install

```bash
npx skills add briqt/my-agent-browser -g
npm install -g chrome-devtools-mcp@latest
mkdir -p ~/.my-agent-browser
cp ~/.agents/skills/my-agent-browser/config.example.json ~/.my-agent-browser/config.json
```

Then add the MCP server to your agent's config (Claude Code example):

```json
{
  "mcpServers": {
    "browser": {
      "command": "~/.agents/skills/my-agent-browser/scripts/start-mcp.sh"
    }
  }
}
```

See [skills/my-agent-browser/references/setup.md](skills/my-agent-browser/references/setup.md) for full setup details.

## How it works

```
Agent (Claude Code / Cursor / Kiro / etc.)
  ↓ MCP tool calls (native)
start-mcp.sh
  ↓ reads ~/.my-agent-browser/config.json, builds args, exec's:
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
│   │   └── start-mcp.sh        # MCP server wrapper
│   ├── config.example.json      # Config template
│   └── references/
│       ├── setup.md             # Installation & configuration
│       └── troubleshooting.md   # Common issues & fixes
├── scripts/
│   └── browser.sh              # Manual Chrome lifecycle (start/stop/status, for debugging)
├── install.sh                   # Optional one-step installer
├── config.example.json          # Config template (also in skill/)
└── README.md
```

## Updating

```bash
npx skills update my-agent-browser -g
npm install -g chrome-devtools-mcp@latest
```
