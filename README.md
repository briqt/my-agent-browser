# my-agent-browser

[![Platform](https://img.shields.io/badge/Platform-Linux%20%7C%20macOS%20%7C%20Windows-blue)]()

Stealth, managed Chrome DevTools **CLI + Skill** for AI agents, built on [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) **1.13.0**.

**[中文文档](README_CN.md)**

## Why CLI Instead of MCP

- **Zero Context Bloat**: Exposing browser MCP tools burns 15k–30k+ tokens on every conversation turn before opening a webpage. The CLI + Skill approach costs ~100 tokens idle and loads guidance only when needed.
- **Zero Client Setup**: Works across Claude Code, Codex, Cursor, Antigravity, Kiro, and any shell-capable agent without per-IDE JSON/TOML files. Config edits apply via `my-agent-browser restart`.
- **Unix Composability**: Capture `ID=$(my-agent-browser open <url> --raw)`, chain steps with `&&`, pipe `eval --raw | jq`, and slice heavy snapshots on disk (`snap 1 /tmp/s.txt && grep ...`).

## What This Adds Over Bare Browser CLIs

### 1. Measured Anti-Detection & Clean Browser Launch
- Launches system Chrome / Edge / Brave / Chromium / Arc directly **without** Puppeteer's `--enable-automation` (`navigator.webdriver === false` out of the box, no 400 MB Chrome-for-Testing download).
- Automatically rewrites inline `eval` functions so page-side `Error.stack` traps see no `pptr:` frame and no local install path — see [anti-detection.md](skills/my-agent-browser/references/anti-detection.md).
- Ships a measured Chrome flag set preserving real GPU WebGL and native scrollbar metrics.

### 2. Multi-Agent `owner` Coordination & On-Demand Lifecycle
- **Per-tab `owner` locks** (`--owner <name>` / `MY_AGENT_BROWSER_OWNER`): Lock tabs on `open` or `claim`, inspect active owners and `canStopSafely` via `pages` and `status`, and prevent other agents from mutating your tabs or stopping Chrome mid-task.
- **Always background new tabs**: `open` always creates tabs in the background without stealing OS window focus.
- **On-demand launch & idle auto-close** (`browser.idleTimeout`): Daemon and Chrome start only when needed and auto-close after `"30m"` of inactivity (set `"never"` or `0` to keep Chrome open). External `browserUrl` browsers (`http://` or `ws://`) are never closed.
- **Self-healing**: Probes CDP before relaunching crashed browsers, cleans stale `SingletonLock` files, and hot-replaces stale engine subprocesses without replaying mutations.

### 3. Ergonomic Daily Commands + All 50 DevTools Tools Ready Out of the Box
- Concise commands (`open --raw`, `pages`, `goto`, `snap`, `shot --raw`, `click`, `click-at`, `fill`, `fill-form`, `wait-for`, `eval --raw`, `console`, `network`, `logpoints`).
- Fixes upstream CLI gaps (restores `fill-form` and `wait-for`, normalizes `<pageId>` order, saves screenshots to files instead of dumping base64, provides offline `<tool> --help`).
- **50 upstream tools enabled with zero config**: Includes `mock_network`, `remove_network_mock`, `configure_webauthn`, `click_at`, `lighthouse_audit`, `set_logpoints`, `performance_start_trace`, `emulate`, `screencast_start`, and `take_heapsnapshot` + all 13 offline V8 heap analysis tools.

## Install

```bash
npm i -g github:briqt/my-agent-browser --install-links
npx skills add briqt/my-agent-browser -g -y
```

Optional first-time config init & offline health check:

```bash
my-agent-browser config init
my-agent-browser doctor --json
```

### Upgrading from v1.x (MCP)

1. Run the two install commands above.
2. Remove the old `start-mcp.js` MCP entry in your agent settings *(a tiny compatibility stub prevents startup errors until removed)*.
3. Existing `~/.config/agent-skills/my-agent-browser/config.json` and `user-data/` continue to work (legacy `mcp.*` and `browser.lazyStart` keys are ignored automatically).

## Quick Start

```bash
ID=$(my-agent-browser open "https://example.com" --owner agent-1 --raw)
my-agent-browser pages
my-agent-browser snap "$ID"
my-agent-browser eval "$ID" "() => document.title" --raw
my-agent-browser shot "$ID" /tmp/example.png
my-agent-browser status
my-agent-browser close-page "$ID" --owner agent-1
```

## Configuration

Edit `~/.config/agent-skills/my-agent-browser/config.json` (inspect with `my-agent-browser config show`, apply with `my-agent-browser restart`):

```json
{
  "browser": {
    "headless": true,
    "idleTimeout": "30m",
    "proxy": "",
    "viewport": "1280x720",
    "browserUrl": ""
  },
  "stealth": {
    "evaluateScript": true,
    "sourceUrl": "eval.js"
  },
  "disable_update_check": false
}
```

See [setup.md](skills/my-agent-browser/references/setup.md), [multi-tab-workflow.md](skills/my-agent-browser/references/multi-tab-workflow.md), and [advanced-tools.md](skills/my-agent-browser/references/advanced-tools.md).

## Updating

```bash
npm i -g github:briqt/my-agent-browser --install-links
npx skills add briqt/my-agent-browser -g -y
```

## Community

[学 AI，上 Linux DO](https://linux.do/)

## License

[MIT](LICENSE)
