# Setup & Configuration

## Prerequisites

- Google Chrome, Microsoft Edge, Chromium, Brave, or Arc installed
- Node.js 20.19+ on 20.x, 22.12+ on 22.x, or 23+ (Node 24 LTS recommended)

## Installation

```bash
npm i -g github:briqt/my-agent-browser --install-links
npx skills add briqt/my-agent-browser -g -y
```

`chrome-devtools-mcp@1.13.0` is bundled inside `my-agent-browser`. No separate install or MCP client configuration is required.

Optional first-time config init and offline check:

```bash
my-agent-browser config init
my-agent-browser doctor --json
```

### Upgrading from v1.x (MCP Era)

1. Run the two install commands above.
2. Remove the old `start-mcp.js` MCP server entry in your agent's MCP settings (a tiny stub at `skills/my-agent-browser/scripts/start-mcp.js` prevents startup errors until removed).
3. Existing `~/.config/agent-skills/my-agent-browser/config.json` and `user-data/` continue to work — legacy `mcp.*` and `browser.lazyStart` keys are safely ignored.

## Configuration

User configuration lives at `~/.config/agent-skills/my-agent-browser/config.json` (override runtime directory with `MY_AGENT_BROWSER_HOME`):

```json
{
  "browser": {
    "userDataDir": "~/.config/agent-skills/my-agent-browser/user-data",
    "headless": true,
    "proxy": "",
    "viewport": "1280x720",
    "display": "",
    "debuggingPort": 39813,
    "extraArgs": [
      "--disable-dev-shm-usage",
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
      "--disable-features=TranslateUI"
    ],
    "browserUrl": "",
    "idleTimeout": "30m"
  },
  "stealth": {
    "evaluateScript": true,
    "sourceUrl": "eval.js"
  },
  "disable_update_check": false
}
```

Inspect effective settings with `my-agent-browser config show` and apply edits with `my-agent-browser restart`.

### Configuration Fields

| Field | Description | Default |
|---|---|---|
| `browser.userDataDir` | Chrome profile directory (cookies and logins persist here) | `~/.config/agent-skills/my-agent-browser/user-data` |
| `browser.headless` | Run without a visible window (`false` for interactive login or strict anti-bot sites) | `true` |
| `browser.idleTimeout` | Auto-close managed Chrome and daemon after inactivity (`"30m"`, `"1h"`, `"300s"`), or `"never"` / `0` | `"30m"` |
| `browser.proxy` | HTTP/SOCKS proxy for browser traffic (e.g. `"http://127.0.0.1:3067"`) | `""` |
| `browser.viewport` | `"WIDTHxHEIGHT"` (e.g. `"1280x720"`), `"maximized"` (`1920x1080` in headless), or `""` for Chrome default | `"1280x720"` |
| `browser.display` | Linux fallback `DISPLAY` value when unset (WSLg is auto-detected) | `""` |
| `browser.debuggingPort` | Local Chrome remote debugging port | `39813` |
| `browser.browserUrl` | Existing Chrome CDP HTTP (`http://127.0.0.1:9222`) or WebSocket (`ws://...`) URL. Never launches or closes external Chrome | `""` |
| `browser.extraArgs` | Extra Chrome startup flags | Vetted 12-flag set |
| `stealth.evaluateScript` | Rewrite inline `eval` functions so stack traces hide `pptr:` and local paths | `true` |
| `stealth.sourceUrl` | Source URL token shown in rewritten `eval` stack traces | `"eval.js"` |
| `disable_update_check` | Disable CLI update checks and cached stderr notices | `false` |

### Built-In Defaults (Zero Config Needed)

- **On-demand launch**: Daemon and Chrome start only when a browser command is invoked (offline heap analysis tools, `status`, `doctor`, and `--help` never launch Chrome).
- **Background new tabs**: `open` / `new_page` always opens tabs in the background without stealing OS window focus.
- **All 50 DevTools tools enabled**: Navigation, Input (including `click_at`), Snapshots/Screenshots, `evaluate_script`, `set_logpoints`, Console, Network, Network Mocks (`mock_network` / `remove_network_mock`), Performance, Lighthouse, Emulation, Screencast, WebAuthn (`configure_webauthn`), and V8 Heap Snapshot capture + all 13 offline heap analysis tools are enabled out of the box.

### Idle Timeout (`browser.idleTimeout`)

- Accepts `<number><ms|s|m|h>` (e.g. `"10m"`, `"30m"`, `"2h"`) or `"never"` / `0`.
- Override per launch: `my-agent-browser start --idle-timeout 1h` or `never`.
- Active in-flight commands pause idle expiration. External `browserUrl` browsers are never closed.

### Chrome Flags to Avoid

Measured on Chrome 148 — see [anti-detection.md](anti-detection.md):
- **`--disable-gpu`**: Breaks WebGL (`getContext('webgl') === null`) unless paired with `--enable-unsafe-swiftshader`.
- **`--disable-blink-features=AutomationControlled`**: Unnecessary (Chrome is launched without `--enable-automation`) and triggers Chrome's yellow warning bar (~52px height loss).
- **`--hide-scrollbars`**: Reports scrollbar width `0` instead of `15` (bot tell).

## Updating & Uninstalling

```bash
# Update
npm i -g github:briqt/my-agent-browser --install-links
npx skills add briqt/my-agent-browser -g -y
my-agent-browser restart   # when no other agent is mid-task

# Uninstall
my-agent-browser stop --force
npm uninstall -g my-agent-browser
npx skills remove my-agent-browser -g
rm -rf ~/.config/agent-skills/my-agent-browser
```
