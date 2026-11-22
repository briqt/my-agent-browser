# my-agent-browser

[![Platform](https://img.shields.io/badge/Platform-Linux%20%7C%20macOS%20%7C%20Windows-blue)]()

Stealth, managed Chrome DevTools **CLI + Skill** for AI agents, built on [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) **1.13.0**.

**[中文文档](README_CN.md)**

## Why v2.0 Moves from MCP to CLI

- **Zero Context Bloat**: Exposing 33+ browser MCP tools burns ~15k–30k tokens in every conversation before you even open a webpage. The CLI + Skill approach costs ~100 tokens idle and loads workflow guidance only when needed.
- **Zero MCP Client Setup**: Works immediately across Claude Code, Codex, Cursor, Antigravity, Kiro, and any shell-capable agent — no per-IDE JSON/TOML configuration, and config changes apply via `my-agent-browser restart` without restarting your agent conversation.
- **Decoupled Lifecycle + Unix Composability**: Pipe `eval --raw | jq`, save heavy snapshots to disk (`snap 1 /tmp/s.txt && grep ...`), and share one persistent logged-in Chrome safely across multiple agents.

## What This Adds Over Bare Browser CLIs

### 1. Measured Anti-Detection & Clean Browser Launch
- Launches system Chrome / Edge / Brave / Chromium / Arc directly **without** Puppeteer's `--enable-automation` (`navigator.webdriver === false` out of the box, no 400 MB Chrome-for-Testing download required).
- Automatically rewrites inline `eval` (`evaluate_script`) functions so page-side `Error.stack` traps see no `pptr:` frame and no install path leaking your OS username — see [anti-detection.md](skills/my-agent-browser/references/anti-detection.md).
- Ships a measured Chrome flag set (preserving real GPU WebGL and native scrollbar metrics instead of cargo-cult flags that trigger bot detectors).

### 2. Multi-Agent `owner` Coordination & Configurable Idle Shutdown
- **Per-tab `owner` locks** (`--owner <name>` / `MY_AGENT_BROWSER_OWNER`): Agents can lock tabs they open or claim, discover who else is using Chrome via `pages` and `status` (`canStopSafely`), and prevent other agents from mutating their tabs or stopping the shared browser mid-task.
- **Configurable idle auto-close** (`browser.idleTimeout`): Defaults to `"30m"` so idle browsers don't linger forever, or set `"never"` (`0`) to keep Chrome open permanently. External `browserUrl` browsers are never closed.
- **Crash & Stale-State Self-Healing**: Probes CDP `/json/version` before relaunching crashed browsers, cleans stale `SingletonLock` files, and hot-replaces stale MCP engine subprocesses without replaying mutations.

### 3. Ergonomic Daily Commands + 100% Chrome DevTools Native Ceiling
- Concise commands for the core loop (`open`, `pages`, `goto`, `snap`, `shot`, `click`, `fill`, `fill-form`, `wait-for`, `eval --raw`, `batch`).
- Fixes upstream CLI gaps (`fill-form` and `wait-for` restored, consistent `<pageId>` ordering on `eval`, `--clear` on `logpoints`, automatic file saving on `shot` instead of base64 context dumps).
- **Zero-loss native ceiling**: Every `chrome-devtools-mcp` tool (`lighthouse_audit`, `set_logpoints`, `performance_start_trace`, `take_heapsnapshot`, `mock_network`, `configure_webauthn`, `emulate`, …) is directly callable via `my-agent-browser <tool>`.

## Install

Only two commands — `chrome-devtools-mcp@1.13.0` is bundled and managed automatically:

```bash
npm i -g github:briqt/my-agent-browser --install-links
npx skills add briqt/my-agent-browser -g -y
```

Optional first-time config initialization & health check:

```bash
my-agent-browser config init
my-agent-browser doctor --json
```

### Upgrading from v1.x (MCP)

1. Run the two install commands above.
2. Remove the old `browser` MCP server entry (`start-mcp.js`) using your agent's own MCP configuration settings. *(Until removed, a tiny compatibility stub at `skills/my-agent-browser/scripts/start-mcp.js` prevents startup errors and reminds the agent to remove the legacy MCP entry.)*
3. Your existing `~/.config/agent-skills/my-agent-browser/config.json` and `user-data/` profile continue to work unchanged.

## Quick Start

```bash
my-agent-browser open "https://example.com" --owner agent-1
my-agent-browser pages
my-agent-browser snap 1
my-agent-browser eval 1 "() => document.title" --raw
my-agent-browser shot 1 /tmp/example.png
my-agent-browser status
my-agent-browser close-page 1 --owner agent-1
```

## Configuration Highlights

Edit `~/.config/agent-skills/my-agent-browser/config.json` (apply anytime with `my-agent-browser restart`):

```json
{
  "browser": {
    "headless": true,
    "idleTimeout": "30m",
    "proxy": "",
    "viewport": "1280x720"
  },
  "mcp": {
    "backgroundNewPages": false,
    "batchActions": true,
    "flags": []
  },
  "stealth": {
    "evaluateScript": true,
    "sourceUrl": "eval.js"
  }
}
```

- Set `"idleTimeout": "never"` (or `0`) to never auto-close Chrome.
- Set `"backgroundNewPages": true` to open new tabs in the background by default unless `--foreground` is passed.
- Add `"--categoryNetworkMocks"` or `"--memoryDebugging"` to `mcp.flags` to unlock network response mocking and V8 heap analysis tools.

See [setup.md](skills/my-agent-browser/references/setup.md), [multi-tab-workflow.md](skills/my-agent-browser/references/multi-tab-workflow.md), and [batch-actions.md](skills/my-agent-browser/references/batch-actions.md) for full details.

## Updating

```bash
npm i -g github:briqt/my-agent-browser --install-links
npx skills add briqt/my-agent-browser -g -y
```

## Community

Shared on [LINUX DO](https://linux.do/t/topic/2451355)
