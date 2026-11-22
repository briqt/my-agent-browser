# Setup & Configuration

## Prerequisites

- Google Chrome, Microsoft Edge, Chromium, Brave, or Arc installed
- Node.js 20.19+ on 20.x, 22.12+ on 22.x, or 23+ (Node 24 LTS recommended)

## Installation (Two Commands, No MCP Setup)

```bash
npm i -g github:briqt/my-agent-browser --install-links
npx skills add briqt/my-agent-browser -g -y
```

- **No separate upstream install needed**: `my-agent-browser` declares and bundles the exact tested `chrome-devtools-mcp@1.13.0` dependency inside its own package.
- **No MCP configuration**: Agents invoke `my-agent-browser` via shell commands only when browser automation is needed, keeping ~30k tokens of MCP tool schemas out of every conversation.

Create your personal config file (optional — sensible defaults work out of the box, and existing configs are preserved):

```bash
my-agent-browser config init
my-agent-browser doctor --json
```

### Upgrading from v1.x (MCP Era)

1. Install the v2.0 CLI and update the skill with the two commands above.
2. Remove the old `browser` MCP server entry (`start-mcp.js`) using your agent's own MCP configuration management.
   - Until removed, `skills/my-agent-browser/scripts/start-mcp.js` acts as a lightweight deprecation stub (`my_agent_browser_mcp_deprecated`) so existing agent sessions do not crash on startup.
3. Optional cleanup:
   - If you previously installed `chrome-devtools-mcp` globally just for v1.x, you can run `npm uninstall -g chrome-devtools-mcp` (v2.0 manages its own bundled copy).
   - Your existing `~/.config/agent-skills/my-agent-browser/config.json` and `user-data/` profile work unchanged in v2.0.

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
    "lazyStart": true,
    "idleTimeout": "30m"
  },
  "mcp": {
    "features": [],
    "flags": [],
    "backgroundNewPages": false,
    "batchActions": true
  },
  "stealth": {
    "evaluateScript": true,
    "sourceUrl": "eval.js"
  },
  "disable_update_check": false
}
```

After editing `config.json`, apply changes immediately without restarting your agent session:

```bash
my-agent-browser restart
```

### Configuration Fields

| Field | Description | Default |
|---|---|---|
| `browser.userDataDir` | Chrome profile directory (cookies and logins persist here) | `~/.config/agent-skills/my-agent-browser/user-data` |
| `browser.headless` | Run without a visible window (`true` for background/CI, `false` for interactive login or strict anti-bot sites) | `true` |
| `browser.idleTimeout` | Auto-close managed Chrome and daemon after inactivity (`"30m"`, `"1h"`, `"300s"`), or `"never"` / `0` to never auto-close | `"30m"` |
| `browser.lazyStart` | Delay launching Chrome until the first browser command (`false` launches when `start` runs) | `true` |
| `browser.proxy` | HTTP/SOCKS proxy for browser traffic (e.g. `"http://127.0.0.1:3067"`) | `""` |
| `browser.viewport` | Window size as `"WIDTHxHEIGHT"` (e.g. `"1280x720"`), `"maximized"` (`1920x1080` in headless), or `""` for Chrome default | `"1280x720"` |
| `browser.display` | Linux fallback `DISPLAY` value when unset (WSLg is auto-detected) | `""` |
| `browser.debuggingPort` | Local Chrome remote debugging port | `39813` |
| `browser.browserUrl` | Connect to an existing external Chrome (`"http://127.0.0.1:9222"`). Skips launching and never closes external Chrome | `""` |
| `browser.extraArgs` | Extra Chrome startup flags (see vetted list below) | Vetted 12-flag set |
| `mcp.backgroundNewPages` | Supply `background: true` on `open` / `new_page` when not explicitly passed (`--foreground` / `--background` always win) | `false` |
| `mcp.batchActions` | Enable `batch` (`run_actions`) compound execution | `true` |
| `mcp.flags` / `mcp.features` | Passthrough CLI flags to `chrome-devtools-mcp` (see below) | `[]` |
| `stealth.evaluateScript` | Rewrite inline `eval` functions so page stack traces hide `pptr:` and OS username paths | `true` |
| `stealth.sourceUrl` | Source URL token shown in rewritten `eval` stack traces (single non-whitespace token) | `"eval.js"` |
| `disable_update_check` | Disable CLI update checks and cached stderr notices | `false` |

### Idle Timeout (`browser.idleTimeout`)

- Accepts a positive integer with unit (`ms`, `s`, `m`, `h`), such as `"10m"`, `"30m"`, `"2h"`.
- Set `"never"` (or `0`) to keep the daemon and browser alive indefinitely until `my-agent-browser stop`.
- Can also be overridden per daemon launch:
  ```bash
  my-agent-browser start --idle-timeout 1h
  my-agent-browser start --idle-timeout never
  ```
- Active in-flight commands pause idle expiration; countdown restarts when the command finishes.
- In `direct` mode (`browser.browserUrl`), idle timeout stops only the local daemon and leaves your external Chrome untouched.

### Tuning Upstream Tool Categories (`mcp.flags`)

Out of the box, **33 tools** are active (Navigation, Input, Snapshots/Screenshots, `evaluate_script`, `set_logpoints`, Console, Network, Performance, Lighthouse, Emulation, `take_heapsnapshot`). Add flags to `mcp.flags` (and run `my-agent-browser restart`) to unlock opt-in categories:

| Flag | Effect |
|---|---|
| `--categoryNetworkMocks` | Enable page-scoped `mock_network` and `remove_network_mock` (local file or upstream URL replacement) |
| `--memoryDebugging` | Enable 13 V8 heap-snapshot analysis tools (`get_heapsnapshot_summary`, `get_heapsnapshot_dominators`, `compare_heapsnapshots`, …) |
| `--categoryWebauthn` | Enable `configure_webauthn` virtual passkey / security-key authenticator |
| `--categoryExtensions` | Enable Chrome unpacked extension management tools |
| `--experimentalVision` | Enable coordinate-based `click_at <pageId> <x> <y>` |
| `--workspace=/abs/path` | Restrict upstream file reads/writes to explicit directory roots instead of unrestricted local paths |

### Chrome Flags to Avoid

Measured on Chrome 148 one flag at a time — details in [anti-detection.md](anti-detection.md):
- **`--disable-gpu`**: Breaks WebGL (`getContext('webgl') === null`) unless paired with `--enable-unsafe-swiftshader`. Try nothing → `--ignore-gpu-blocklist` → `--enable-unsafe-swiftshader`.
- **`--disable-blink-features=AutomationControlled`**: Unnecessary here (`my-agent-browser` never passes `--enable-automation`, so `navigator.webdriver` is already `false`) and triggers Chrome's yellow warning bar (~52px height loss).
- **`--hide-scrollbars`**: Reports scrollbar width `0` instead of `15` (a strong bot tell). Use only for scrollbar-free screenshots.

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
