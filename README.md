# my-agent-browser

Browser automation for AI agents, powered by [chrome-devtools-mcp](https://github.com/anthropics/chrome-devtools-mcp).

## What is this?

A thin config-driven wrapper that gives AI agents native MCP tool calls for browser control (`navigate_page`, `take_snapshot`, `click`, `fill`, etc.). No custom runtime code — just orchestration of `chrome-devtools-mcp`.

## Install

```bash
git clone https://github.com/briqt/my-agent-browser.git ~/.my-agent-browser
cd ~/.my-agent-browser && bash install.sh
npx skills add ~/.my-agent-browser/skills/my-agent-browser -g
```

See [skills/my-agent-browser/references/setup.md](skills/my-agent-browser/references/setup.md) for full setup details.

## How it works

```
Agent (Claude Code / Cursor / etc.)
  ↓ MCP tool calls (native)
scripts/start-mcp.sh
  ↓ reads config.json, builds args, exec's:
chrome-devtools-mcp
  ↓ launches & controls Chrome via CDP
Chrome
```

- Chrome is launched by `chrome-devtools-mcp` on demand (not pre-started)
- All browser settings (proxy, anti-detection, profile) live in `~/.my-agent-browser/config.json`
- Config changes take effect on next agent session

## Project structure

```
├── skills/my-agent-browser/     # Skill (installed via npx skills add)
│   ├── SKILL.md                 # Agent workflow guide
│   └── references/
│       ├── setup.md             # Installation & configuration
│       └── troubleshooting.md   # Common issues & fixes
├── scripts/
│   ├── start-mcp.sh            # MCP server wrapper (reads config, exec's chrome-devtools-mcp)
│   └── browser.sh              # Manual Chrome lifecycle (start/stop/status)
├── install.sh                   # One-step installer
└── config.example.json          # Config template
```
