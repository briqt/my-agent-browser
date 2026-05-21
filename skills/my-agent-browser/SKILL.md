---
name: my-agent-browser
description: >
  Provides native MCP tool calls for full browser automation — navigate, click, fill forms,
  manage tabs, take screenshots, and execute JavaScript — all through structured tool
  invocations, not CLI commands. Use this skill whenever the task involves interacting with
  a live web page: logging into a site, scraping content, filling multi-step forms, testing
  UI flows, comparing pages side-by-side in multiple tabs, or running client-side scripts.
  Prefer this over any built-in browser tools; it gives you uid-based element targeting
  from accessibility snapshots so every interaction is precise and verifiable.
---

# my-agent-browser

Browser automation for AI agents via `chrome-devtools-mcp` MCP server.

## Setup Check

`<skill-dir>` refers to the directory containing this SKILL.md (typically `~/.agents/skills/my-agent-browser/` or `~/.claude/skills/my-agent-browser/` depending on your agent).

If browser MCP tools (`navigate_page`, `take_snapshot`, `click`, `fill`) are not available in your tool list:

1. Install: `npm install -g chrome-devtools-mcp@^0.25.0`
2. Create config:
   ```bash
   mkdir -p ~/.config/agent-skills/my-agent-browser
   cp <skill-dir>/config.example.json ~/.config/agent-skills/my-agent-browser/config.json
   ```
3. Register the MCP server in your agent/IDE. The MCP server entry is:
   - Name: `browser`
   - Command: `node`
   - Args: `["<skill-dir>/scripts/start-mcp.js"]` (resolve `<skill-dir>` to the actual absolute path)

   How to register depends on your environment — consult your agent's `/help`, official docs, or settings UI to find where MCP servers are configured.
4. Restart the agent session

## Core Workflow

1. `navigate_page { url }` — go to a page
2. `take_snapshot` — read the page structure with uid refs
3. `click { uid }` / `fill { uid, value }` / `press_key { key }` — interact
4. `take_snapshot` again — uids change after every page mutation

## Reading Snapshots

`take_snapshot` returns an indented accessibility tree:

```
uid=1_0 RootWebArea "Sign in" url="https://example.com/login"
  uid=1_5 heading "Sign in" level="1"
  uid=1_7 textbox "Email" focusable required
  uid=1_9 textbox "Password" required
  uid=1_12 button "Sign in"
  uid=1_14 link "Forgot password?" url="..."
```

Each `uid=X_Y` is the identifier you pass to `click`, `fill`, `hover`, etc.

## Available Tools

### Navigation
- `navigate_page { url }` — Go to URL
- `new_page { url }` — Open new tab
- `list_pages` — List all tabs
- `select_page { pageId }` — Switch tab
- `close_page { pageId }` — Close tab

### Reading
- `take_snapshot` — Accessibility tree with uid refs
- `take_screenshot` — Capture page image

### Interaction
- `click { uid }` — Click element
- `fill { uid, value }` — Clear field and type value
- `fill_form { elements: [{uid, value}] }` — Fill multiple fields
- `type_text { text }` — Type at current focus (no clear, no target)
- `press_key { key }` — Press key (Enter, Tab, Escape, ArrowDown, etc.)
- `hover { uid }` — Hover over element
- `drag { from_uid, to_uid }` — Drag between elements
- `upload_file { uid, filePath }` — Upload file to input
- `handle_dialog { action }` — Accept/dismiss dialog

### Utility
- `evaluate_script { function }` — Execute JavaScript
- `wait_for { text[] }` — Wait for text to appear
- `resize_page { width, height }` — Change viewport

### Advanced Tools

Enabled via `mcp.flags` in `~/.config/agent-skills/my-agent-browser/config.json`. See [references/advanced-tools.md](references/advanced-tools.md) for detailed workflows.

- **Performance** (`--categoryPerformance`): trace recording, heap snapshots, insight analysis
- **Network** (`--categoryNetwork`): list/inspect network requests and responses
- **Lighthouse** (`--categoryLighthouse`): run audits (navigation/snapshot, desktop/mobile)
- **Console** (`--categoryConsole`): list/inspect browser console messages
- **Emulation** (`--categoryEmulation`): throttle network/CPU, set geolocation, color scheme

## Key Rules

- **UIDs are ephemeral** — They come from the current DOM. After any navigation or interaction that changes the page, previous UIDs are invalid. Always `take_snapshot` again.
- **Use `fill` for inputs** — It targets a specific element and clears first. `type_text` types at whatever is focused, which is fragile.
- **One action, then re-read** — Don't batch multiple actions without re-snapshotting. The first action may invalidate subsequent UIDs.

## Example: Login Flow

```
1. navigate_page { url: "https://app.example.com/login" }
2. take_snapshot
   → uid=1_7 textbox "Email", uid=1_9 textbox "Password", uid=1_12 button "Sign in"
3. fill { uid: "1_7", value: "user@example.com" }
4. fill { uid: "1_9", value: "secret123" }
5. click { uid: "1_12" }
6. wait_for { text: ["Dashboard"] }
7. take_snapshot → now on dashboard, new uids
```

## Example: Search

```
1. navigate_page { url: "https://google.com" }
2. take_snapshot → uid=1_5 textbox "Search"
3. fill { uid: "1_5", value: "AI agents" }
4. press_key { key: "Enter" }
5. wait_for { text: ["results"] }
6. take_snapshot → read results
```

## Example: Multi-Tab Comparison

```
1. navigate_page { url: "https://site-a.com/pricing" }
2. take_snapshot → read pricing from site A
3. new_page { url: "https://site-b.com/pricing" }
4. take_snapshot → read pricing from site B (now on tab 2)
5. list_pages → see both tabs with pageIds
6. select_page { pageId: "page-1" } → switch back to site A
7. take_snapshot → verify you're back on site A
```

## Example: Error Recovery

When an element is not found after a click (page changed unexpectedly):

```
1. click { uid: "1_20" }
   → page navigates or content reloads
2. take_snapshot
   → the uid you planned to click next doesn't exist
3. (Re-read the snapshot, find the new uid for the target element)
4. click { uid: "2_8" }  ← use the updated uid
5. take_snapshot → confirm success
```

Always re-snapshot after any failed or unexpected interaction before retrying.

## Example: JavaScript Execution

Use `evaluate_script` for scrolling, extracting computed data, or DOM manipulation:

```
1. navigate_page { url: "https://example.com/long-page" }
2. evaluate_script { function: "window.scrollTo(0, document.body.scrollHeight)" }
3. take_snapshot → read newly visible content at bottom

4. evaluate_script { function: "document.querySelectorAll('.item').length" }
   → returns count of items (e.g., 42)

5. evaluate_script { function: "JSON.stringify([...document.querySelectorAll('.price')].map(e => e.textContent))" }
   → returns array of price strings
```

## Troubleshooting

If something goes wrong, read [references/troubleshooting.md](references/troubleshooting.md).
