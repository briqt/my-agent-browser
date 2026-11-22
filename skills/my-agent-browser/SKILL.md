---
name: my-agent-browser
description: >
  Browser automation and Chrome DevTools CLI for AI agents. Trigger this skill BEFORE starting
  any browser interaction (navigating pages, logging in, scraping, filling forms, testing UI,
  inspecting network/console/performance) to learn the CLI workflow and avoid common pitfalls.
  Also trigger when browser commands misbehave (stale UIDs, heavy-page hangs, tab ownership
  locks, timeouts) or when `my_agent_browser_mcp_deprecated` appears in MCP tools.
metadata:
  version: "2.1.0"
---

# my-agent-browser

Stealth, managed Chrome DevTools CLI (`my-agent-browser`), powered by bundled `chrome-devtools-mcp@1.13.0` behind a local background daemon — **zero MCP configuration, zero context bloat, and 50 DevTools tools ready out of the box**.

## Setup & Health Check

Needs `my-agent-browser` CLI **2.1.0+** (`my-agent-browser --version`, Node 20.19+ / 22.12+ / 24 LTS recommended). Inspect local installation offline:

```bash
my-agent-browser doctor --json
```

Install or update:

```bash
npm i -g github:briqt/my-agent-browser --install-links   # installs CLI + chrome-devtools-mcp@1.13.0
npx skills add briqt/my-agent-browser -g -y              # installs/updates this skill
my-agent-browser config init                             # creates ~/.config/agent-skills/my-agent-browser/config.json if absent
```

- **Upgrading from v1.x MCP**: If `my_agent_browser_mcp_deprecated` appears in your agent's MCP tools, remove the legacy `start-mcp.js` MCP entry in your agent settings.

## Core Loop

Daemon and Chrome launch automatically on your first browser command. New tabs always open in the background without stealing OS focus.

```bash
ID=$(my-agent-browser open "https://example.com/login" --owner my-task --raw)
my-agent-browser snap "$ID"                                           # accessibility tree with uid=X_Y refs
my-agent-browser fill-form "$ID" 1_7="user@example.com" 1_9="secret" && \
  my-agent-browser click "$ID" 1_12 && \
  my-agent-browser wait-for "$ID" "Dashboard"
my-agent-browser close-page "$ID" --owner my-task                     # close YOUR tab when finished
```

1. **Open & capture `pageId`**: `open <url> --raw` prints only the numeric `pageId` (or read it from `open` / `pages`). Pass it as the first number on page-scoped commands (`snap 1`).
2. **Observe** with `snap <pageId>` to read `uid=X_Y` element references.
3. **Act**: Use `fill-form` for multiple inputs, chain known stable steps in your shell with `&&` (fail-fast), or run single commands when the next step depends on updated DOM.
4. **Re-observe** after navigation, DOM replacement, or any new decision point. Unchanged nodes keep their UIDs across snapshots; replaced nodes or reloads invalidate them.

## Shared Browser, `owner` Locks & Lifecycle

All agents under the same OS user share one daemon and one Chrome profile (`~/.config/agent-skills/my-agent-browser/user-data`).

- **Check active usage**:
  - `my-agent-browser pages` — lists every open tab with `owner=<name>` and `idle=<duration>`.
  - `my-agent-browser status` — shows daemon/browser state, `idleTimeout`, `activeOwners`, and **`Safe to stop now: yes/no`** (`canStopSafely` in `--json`).
- **Isolate your tabs**: Pass `--owner <unique-name>` (or export `MY_AGENT_BROWSER_OWNER=<unique-name>`) on `open` or `claim <pageId>`. Mutating commands on an owned tab require matching `--owner` (unless `--force` is explicitly authorized). Read-only commands (`pages`, `status`, `snap`, `shot`, `console`, `network`, `wait-for`) never block on ownership.
- **Close your tab, not the whole browser**: Run `close-page <pageId>` when finished (even if it is Chrome's last tab, your `owner` lock is released automatically). Do **not** run `stop` unless asked or `status` confirms `canStopSafely` (`stop` refuses if another owner holds open tabs unless `--force` is passed).
- **Idle auto-close**: Closes managed Chrome and daemon after **`30m`** of inactivity (`browser.idleTimeout`). Set `"never"` or `0` to keep Chrome open indefinitely. External `browserUrl` browsers are never closed.
- **Reload config**: Edit `~/.config/agent-skills/my-agent-browser/config.json` (inspect with `my-agent-browser config show`), then run `my-agent-browser restart`.

## Command Reference

### Core Commands
- `open <url> [--owner <name>] [--isolated-context <name>] [--raw]` — Open background tab (returns `pageId`)
- `pages [--owner <name>] [--json]` — List open tabs, owners, and idle times
- `goto <pageId> <url>` / `reload <pageId>` / `back <pageId>` / `forward <pageId>` — Navigate (`--ignore-cache`, `--init-script`, `--handle-before-unload`)
- `select-page <pageId> [--bring-to-front]` — Logical tab selection (`--bring-to-front` for GUI focus)
- `close-page <pageId>` (alias `close`) — Close tab (releases owner lock on last tab too)
- `snap <pageId> [filePath] [--verbose]` — Accessibility tree snapshot (`-o /tmp/snap.txt` for heavy pages)
- `shot <pageId> [filePath] [--full-page] [--uid <uid>] [--raw]` — Screenshot (always saved to file; `--raw` prints bare path)
- `click <pageId> <uid> [--dbl-click]` — Click element
- `click-at <pageId> <x> <y> [--dbl-click]` — Click by viewport coordinates (useful for canvas/unlabeled UI)
- `fill <pageId> <uid> <value>` — Clear input/textarea/select and enter value
- `fill-form <pageId> <uid=value...>` — Fill multiple fields at once
- `hover <pageId> <uid>` / `drag <pageId> <fromUid> <toUid>` — Pointer actions
- `press <pageId> <key>` — Key or shortcut (`Enter`, `Escape`, `Control+A`)
- `type <pageId> <text> [--submit-key Enter]` — Type at current focus without clearing
- `upload <pageId> <uid> <filePath...>` — Upload local file(s)
- `dialog <pageId> <accept|dismiss> [--prompt-text <text>]` — Handle JS alert/confirm/prompt
- `wait-for <pageId> <text...> [--timeout <ms>] [--visible]` — Wait for text substring (case & whitespace sensitive)
- `eval <pageId> <fn> [--raw]` — Run JS function in page (`--raw` prints bare return value for pipes like `| jq`)

### Full DevTools Native Ceiling (All 50 Upstream Tools Enabled by Default)
Every tool is directly callable by `snake_case` or `kebab-case`. Run `my-agent-browser tools` to list all 50 grouped by category, or `my-agent-browser <tool> --help` offline for exact parameters:
- **Console & Source Logpoints**: `console <pageId> [--types error]`, `get_console_message <pageId> <msgid>`, `logpoints <pageId> "src/app.ts:42 x" [--clear]`
- **Network & Mocks**: `network <pageId> [--resource-types fetch]`, `get_network_request <pageId> --reqid <n>`, `mock_network <pageId> --route <pattern> --body <file>`, `remove_network_mock <pageId>`
- **Performance & Lighthouse**: `performance_start_trace <pageId>`, `performance_stop_trace <pageId>`, `performance_analyze_insight <pageId> <setId> <name>`, `lighthouse_audit <pageId> --mode snapshot`
- **Memory & Heap Analysis**: `take_heapsnapshot <pageId> <file>`, `get_heapsnapshot_summary <file>`, `get_heapsnapshot_dominators <file> <nodeId>`, `compare_heapsnapshots <base> <curr>` (13 offline heap tools — no browser needed)
- **CSS, Emulation, Screencast & WebAuthn**: `get_css_styles <pageId> <uid>`, `emulate <pageId> --color-scheme dark`, `resize_page <pageId> <w> <h>`, `screencast_start <pageId>`, `configure_webauthn <pageId> true`
- **Raw JSON Invocation**: `my-agent-browser call <tool> --args-json '{"pageId":1,...}'`

## Critical Rules & Patterns

### 1. Multi-Step Workflows via Shell Composition
- Use `fill-form` for multiple inputs in one round-trip.
- Chain known stable steps with `&&` (fail-fast) and `open --raw` / `eval --raw` for scripting.
- If a mutating command times out, **never retry blindly** — inspect with `snap` first (timeout is not rollback).

### 2. Heavy Pages (Prevent Context Overflow)
Rich-text editors, large tables, chat histories, and infinite-scroll feeds produce huge accessibility trees:
```bash
my-agent-browser snap 1 /tmp/snap.txt
tail -n 100 /tmp/snap.txt          # modals/dialogs are usually at the end
grep -n -C 3 "Submit" /tmp/snap.txt
```
Keep `--include-snapshot` off on `click` / `fill` / `hover`, and close finished tabs (`close-page`).

### 3. JavaScript Extraction (`eval --raw`)
`eval` automatically wraps inline functions to hide `pptr:` frames and local paths from page-side stack traps. Always pass a **JavaScript function expression** (`"() => ..."`), never a bare expression or TypeScript:
```bash
my-agent-browser eval 1 "() => document.title" --raw
my-agent-browser eval 1 "() => [...document.querySelectorAll('tr')].map(r => [...r.cells].map(c => c.textContent.trim()))" --raw | jq .
```

### 4. Troubleshooting Quick Reference

| Symptom | Cause | Fix |
|---|---|---|
| `command not found: my-agent-browser` | CLI not installed or global npm bin not on PATH | `npm i -g github:briqt/my-agent-browser --install-links` |
| `Page N is owned by '...'` | Tab locked by another agent | Open your own tab (`open <url> --owner <you>`), pass matching `--owner`, or `--force` if authorized |
| `Refusing to stop browser: owner '...'` | Another agent holds open tab(s) | Close only your tab (`close-page <id>`); check `status` |
| Click/fill fails or does nothing | Stale UID after DOM change | `snap <pageId>` again and use the fresh UID |
| `wait-for` times out on visible text | Snapshot normalizes whitespace; DOM text keeps newlines/spaces | Pass a shorter distinctive substring |
| Native `<select>` on macOS ignores `press` | OS-rendered popup menu | Use `fill <pageId> <uid> "<option>"` or `eval` setting `.value` + `change` event |
| Anti-bot challenge / block | Usually exit IP, WebGL renderer, or headless UA | Check `browser.proxy`, WebGL renderer, or `restart --headed` — see [references/anti-detection.md](references/anti-detection.md) |

## References

- Installation & `config.json`: [references/setup.md](references/setup.md)
- Anti-detection measurements & stack hiding: [references/anti-detection.md](references/anti-detection.md)
- Multi-tab & multi-agent `--owner` workflows: [references/multi-tab-workflow.md](references/multi-tab-workflow.md)
- JavaScript execution (`eval`): [references/javascript-execution.md](references/javascript-execution.md)
- Scraping & login patterns: [references/scraping-patterns.md](references/scraping-patterns.md)
- Network debugging & `mock_network`: [references/network-debugging.md](references/network-debugging.md)
- Performance, Lighthouse, Logpoints, Memory, Vision & WebAuthn: [references/advanced-tools.md](references/advanced-tools.md)
- Troubleshooting: [references/troubleshooting.md](references/troubleshooting.md)
- Updates, notices & daemon sync: [references/update-checks.md](references/update-checks.md)
- Upstream `1.13.0` compatibility notes: [references/dependency-upgrades.md](references/dependency-upgrades.md)
- Academic paper download (CNKI, Google Scholar, MDPI): [references/domain/academic-paper-download.md](references/domain/academic-paper-download.md)
