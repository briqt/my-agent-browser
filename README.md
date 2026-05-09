# my-agent-browser

Browser automation for AI agents, powered by [chrome-devtools-mcp](https://github.com/anthropics/chrome-devtools-mcp).

## What is this?

A thin wrapper that lets AI agents control Chrome via native MCP tool calls (`navigate_page`, `take_snapshot`, `click`, `fill`, etc.). No custom code — just config-driven orchestration of `chrome-devtools-mcp`.

## Install

```bash
git clone https://github.com/briqt/my-agent-browser.git ~/.my-agent-browser
cd ~/.my-agent-browser && bash install.sh
```

The installer will:
1. Install `chrome-devtools-mcp` globally
2. Create `~/.my-agent-browser/config.json`
3. Print the MCP server config to add to your agent

## Configuration

`~/.my-agent-browser/config.json`:

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

### Anti-detection example

```json
{
  "browser": {
    "extraArgs": [
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
      "--disable-dev-shm-usage"
    ]
  }
}
```

## How it works

```
Agent (Claude Code / Cursor / etc.)
  ↓ MCP tool calls (native)
start-mcp.sh
  ↓ reads config.json, builds args, exec's:
chrome-devtools-mcp
  ↓ launches & controls Chrome via CDP
Chrome
```

- Chrome is launched by `chrome-devtools-mcp` on first use (not pre-started)
- Config changes take effect on next agent session
- `browser.sh` is available for manual Chrome lifecycle control

## Manual Chrome control

```bash
~/.my-agent-browser/scripts/browser.sh start
~/.my-agent-browser/scripts/browser.sh status
~/.my-agent-browser/scripts/browser.sh stop
```
