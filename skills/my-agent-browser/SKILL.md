---
name: my-agent-browser
description: >
  Browser automation and Chrome DevTools CLI for AI agents. Trigger this skill BEFORE starting
  any browser interaction (navigating pages, logging in, scraping, filling forms, testing UI,
  inspecting network/console/performance) to learn the CLI workflow and avoid common pitfalls.
  Also trigger when browser commands misbehave (stale UIDs, heavy-page hangs, tab ownership
  locks, timeouts) or when `my_agent_browser_mcp_deprecated` appears in MCP tools.
metadata:
  version: "2.0.0"
---

# my-agent-browser

Stealth, managed Chrome DevTools CLI for AI agents (`my-agent-browser`), powered by bundled `chrome-devtools-mcp@1.13.0` behind a local background daemon — **zero MCP configuration and zero tool-schema context bloat**.

## Setup & Health Check

Needs `my-agent-browser` CLI **2.0.0+** (`my-agent-browser --version`, Node 20.19+ / 22.12+ / 24 LTS recommended). Inspect local installation without launching Chrome:

```bash
my-agent-browser doctor --json
```

If `my-agent-browser` is not installed (or out of date):

```bash
npm i -g github:briqt/my-agent-browser --install-links   # installs CLI + chrome-devtools-mcp@1.13.0 automatically
npx skills add briqt/my-agent-browser -g -y              # installs/updates this companion skill
my-agent-browser config init                             # creates ~/.config/agent-skills/my-agent-browser/config.json if absent
```

- **Upgrading from v1.x MCP**: If `my_agent_browser_mcp_deprecated` still appears in your agent's MCP tools, remove that legacy MCP server entry (`start-mcp.js`) using your agent's own MCP configuration management. Browser control now runs exclusively through the `my-agent-browser` CLI.

## Core Loop

The background daemon and Chrome launch automatically on your first browser command:

```bash
my-agent-browser open "https://example.com/login" --owner my-task   # opens a tab and prints numeric pageId
my-agent-browser snap 1                                             # accessibility tree with uid=X_Y refs
my-agent-browser fill-form 1 1_7="user@example.com" 1_9="secret"    # or: batch 1 '[...]' --snapshot final
my-agent-browser click 1 1_12
my-agent-browser wait-for 1 "Dashboard"
my-agent-browser close-page 1 --owner my-task                       # close YOUR tab when finished
```

1. **Get a numeric `pageId`** from `open <url>` or `pages`. Pass it as the first number on page-scoped commands (`1`, e.g. `snap 1`).
2. **Observe** with `snap <pageId>` to read `uid=X_Y` element references.
3. **Act**: use `fill-form` for multiple inputs, `batch` for known stable sequences (fill + submit click), or single commands (`click`, `fill`, `press`, `hover`) when each step depends on new page state.
4. **Re-observe** after navigation, DOM replacement, or any new decision point. Unchanged nodes keep their UIDs across snapshots; replaced nodes or reloads invalidate them.

## Shared Browser, `owner` Locks & Lifecycle

All agents under the same OS user share one daemon and one Chrome profile (`~/.config/agent-skills/my-agent-browser/user-data`).

- **Check who else is using the browser**:
  - `my-agent-browser pages` — lists every open tab with `owner=<name>` and `idle=<duration>`.
  - `my-agent-browser status` — shows daemon/browser state, `idleTimeout`, `activeOwners`, and **`Safe to stop now: yes/no`** (`canStopSafely` in `--json`).
- **Isolate your tabs**: Pass `--owner <unique-name>` (or export `MY_AGENT_BROWSER_OWNER=<unique-name>`) when opening a tab (`open <url> --owner agent-a`) or claiming one (`claim <pageId> --owner agent-a`). Mutating calls on an owned tab require matching `--owner` (anyone else is rejected unless `--force` is explicitly authorized). Read-only commands (`pages`, `status`, `snap`, `shot`, `console`, `network`) never block on ownership.
- **Close your tab, not the whole browser**: Run `close-page <pageId>` when your task ends. Do **not** run `stop` unless the user asks or `status` confirms no other agent is using the browser (`stop` refuses automatically if another owner holds open tabs unless `--force` is passed).
- **Automatic idle shutdown**: By default, the daemon closes Chrome and exits after **`30m`** of inactivity (`browser.idleTimeout` in `config.json`). Set `"idleTimeout": "never"` (or `0`) to keep Chrome open indefinitely, or pass `start --idle-timeout 1h` / `never`. External browsers (`browser.browserUrl`) are never closed by `stop` or idle timeout.
- **Apply config edits without restarting your agent**: Edit `~/.config/agent-skills/my-agent-browser/config.json`, then run `my-agent-browser restart`.

## Command Reference

### Core Commands
- `open <url> [--owner <name>] [--background | --foreground]` — Open tab (returns `pageId`)
- `pages [--owner <name>] [--json]` — List open tabs, owners, and idle times
- `goto <pageId> <url>` / `reload <pageId>` / `back <pageId>` / `forward <pageId>` — Navigate
- `select-page <pageId> [--bring-to-front]` — Logical tab selection (`--bring-to-front` for GUI focus)
- `close-page <pageId>` — Close tab (last remaining tab in Chrome cannot be closed)
- `snap <pageId> [filePath] [--verbose]` — Accessibility tree snapshot (`-o /tmp/snap.txt` for heavy pages)
- `shot <pageId> [filePath] [--full-page] [--uid <uid>]` — Screenshot (always saved to file, never raw base64)
- `click <pageId> <uid> [--dbl-click]` — Click element
- `fill <pageId> <uid> <value>` — Clear input/textarea/select and enter value
- `fill-form <pageId> <uid=value...>` — Fill multiple fields at once
- `hover <pageId> <uid>` / `drag <pageId> <fromUid> <toUid>` — Pointer actions
- `press <pageId> <key>` — Key or shortcut (`Enter`, `Escape`, `Control+A`)
- `type <pageId> <text> [--submit-key Enter]` — Type at current focus without clearing
- `upload <pageId> <uid> <filePath...>` — Upload local file(s)
- `dialog <pageId> <accept|dismiss> [--prompt-text <text>]` — Handle JS alert/confirm/prompt
- `wait-for <pageId> <text...> [--timeout <ms>] [--visible]` — Wait for text substring (case & whitespace sensitive!)
- `eval <pageId> <fn> [--raw]` — Run JS function in page (`--raw` prints bare return value for pipes like `| jq`)
- `batch <pageId> '<actions-json>' [--snapshot final] [--snapshot-file <path>]` — Bounded multi-step batch

### Full DevTools Native Ceiling (All 33+ Upstream Tools)
Every `chrome-devtools-mcp` tool is directly callable by name (`snake_case` or `kebab-case`). Run `my-agent-browser tools` to list all enabled tools, or `my-agent-browser <tool> --help` to inspect exact live parameters:
- **Console & Source Logpoints**: `console <pageId> [--types error]`, `get_console_message <pageId> <msgid>`, `logpoints <pageId> "src/app.ts:42 x" [--clear]`
- **Network & Mocks**: `network <pageId> [--resource-types fetch]`, `get_network_request <pageId> --reqid <n>` (enable `--categoryNetworkMocks` in `mcp.flags` for `mock_network` / `remove_network_mock`)
- **Performance & Lighthouse**: `performance_start_trace <pageId>`, `performance_stop_trace <pageId>`, `performance_analyze_insight <pageId> <setId> <name>`, `lighthouse_audit <pageId> --mode snapshot`
- **Memory, CSS & Emulation**: `take_heapsnapshot <pageId> <file>`, `get_css_styles <pageId> <uid>`, `emulate <pageId> --color-scheme dark`, `resize_page <pageId> <w> <h>`
- **Raw JSON Invocation**: `my-agent-browser call <tool> --args-json '{"pageId":1,...}'`

## Critical Rules & Patterns

### 1. Bounded Batches (`batch`) vs Shell Chaining
- For multiple form fields alone, use `fill-form`.
- For an observed, stable form + terminal submit click/key, use `batch`:
  ```bash
  my-agent-browser batch 1 '[{"tool":"fill","arguments":{"uid":"1_7","value":"alice"}},{"tool":"click","arguments":{"uid":"1_12"}}]' --snapshot final
  ```
  Supports 1–10 steps (`fill`, `fill_form`, `hover`, plus `click` / `press_key` **only last**). Stops immediately on error, dialog, navigation (including same-URL reloads), or new page, omitting input values from step summaries. If a step reports `unknown` (timeout/cancel), **do not resend it blindly** — inspect with `snap` first. See [references/batch-actions.md](references/batch-actions.md).

### 2. Heavy Pages (Prevent Context & Memory Overflow)
Rich-text editors, large tables, chat histories, and infinite-scroll feeds produce huge accessibility trees.
- Save snapshots to disk and inspect selectively:
  ```bash
  my-agent-browser snap 1 /tmp/snap.txt
  tail -n 100 /tmp/snap.txt          # modals/dialogs are usually at the end
  grep -n -C 3 "Submit" /tmp/snap.txt
  ```
- Keep `--include-snapshot` off on `click` / `fill` / `hover`, and close finished tabs (`close-page`).

### 3. JavaScript Extraction (`eval --raw`)
`eval` automatically wraps inline functions to hide `pptr:` frames and your OS username path from page-side stack traps. Always pass a **JavaScript function expression** (`"() => ..."`), never a bare expression or TypeScript:
```bash
my-agent-browser eval 1 "() => document.title" --raw
my-agent-browser eval 1 "() => [...document.querySelectorAll('tr')].map(r => [...r.cells].map(c => c.textContent.trim()))" --raw | jq .
```

### 4. Troubleshooting Quick Reference

| Symptom | Cause | Fix |
|---|---|---|
| `command not found: my-agent-browser` | CLI not installed or global npm bin not on PATH | `npm i -g github:briqt/my-agent-browser --install-links` |
| `Page N is owned by '...'` | Tab locked by another agent | Open your own tab (`open <url> --owner <you>`), pass your `--owner`, or `--force` only when authorized |
| `Refusing to stop browser: owner '...'` | Another agent holds open tab(s) | Close only your tab (`close-page <id>`); check `status` |
| Click/fill fails or does nothing | Stale UID after DOM change | `snap <pageId>` again and use the fresh UID |
| `wait-for` times out on visible text | Snapshot normalizes whitespace; DOM text keeps newlines/spaces | Pass a shorter distinctive substring to `wait-for` |
| Native `<select>` on macOS ignores `press` | OS-rendered popup menu | Use `fill <pageId> <uid> "<option>"` or `eval` setting `.value` + `change` event |
| Anti-bot challenge / block | Usually exit IP or WebGL renderer, not Chrome flags | Check `browser.proxy` and WebGL renderer — see [references/anti-detection.md](references/anti-detection.md) |

## References

- Installation, `config.json`, `idleTimeout`, `backgroundNewPages` & `mcp.flags`: [references/setup.md](references/setup.md)
- Anti-detection measurements & WebGL / stack-hiding details: [references/anti-detection.md](references/anti-detection.md)
- Multi-tab & multi-agent `--owner` workflows: [references/multi-tab-workflow.md](references/multi-tab-workflow.md)
- Bounded batch contract & recovery: [references/batch-actions.md](references/batch-actions.md)
- JavaScript execution (`eval`): [references/javascript-execution.md](references/javascript-execution.md)
- Scraping & login patterns: [references/scraping-patterns.md](references/scraping-patterns.md)
- Network debugging & `mock_network`: [references/network-debugging.md](references/network-debugging.md)
- Performance, Lighthouse, Logpoints, Memory & Emulation: [references/advanced-tools.md](references/advanced-tools.md)
- Troubleshooting: [references/troubleshooting.md](references/troubleshooting.md)
- Updates, notices & daemon version sync: [references/update-checks.md](references/update-checks.md)
- Upstream `1.13.0` compatibility notes: [references/dependency-upgrades.md](references/dependency-upgrades.md)
- Academic paper download (CNKI, Google Scholar, MDPI): [references/domain/academic-paper-download.md](references/domain/academic-paper-download.md)
