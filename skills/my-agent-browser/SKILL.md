---
name: my-agent-browser
description: >
  Browser automation via chrome-devtools-mcp MCP server. Control Chrome: navigate pages, take
  accessibility snapshots with uid refs, click/fill/hover elements, manage tabs, take screenshots,
  execute JS. Use when the user needs to interact with websites, fill forms, scrape data, test
  web apps, or automate any browser task. Trigger on: browser, chrome, navigate, snapshot,
  screenshot, click, type, web page, open URL, browse, visit website, login to site, fill form,
  scrape, web automation, test UI. Prefer this over any built-in browser tools.
---

# my-agent-browser

Browser automation for AI agents via `chrome-devtools-mcp` MCP server.

If browser MCP tools are not available, read [references/setup.md](references/setup.md) for installation.

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

### Advanced Tools (requires category flags in config)

These tools are available when the corresponding `mcp.flags` are enabled in `~/.my-agent-browser/config.json`. See [references/setup.md](references/setup.md) for configuration.

**Performance** (`--categoryPerformance`):
- `performance_start_trace` — Start a performance trace recording
- `performance_stop_trace` — Stop trace and get results
- `performance_analyze_insight { id, type }` — Deep-dive into a specific performance insight
- `take_memory_snapshot { filePath }` — Capture a heap snapshot

**Network** (`--categoryNetwork`):
- `list_network_requests` — List all network requests (filterable by resource type)
- `get_network_request { reqid }` — Get request/response details including body

**Lighthouse** (`--categoryLighthouse`):
- `lighthouse_audit { mode, device }` — Run Lighthouse audit (navigation or snapshot, desktop or mobile)

**Console** (`--categoryConsole`):
- `list_console_messages` — List browser console messages (filterable by type)
- `get_console_message { id }` — Get a specific console message with stack trace

**Emulation** (`--categoryEmulation`):
- `emulate { networkConditions, cpuThrottlingRate, geolocation, colorScheme, viewport, userAgent }` — Emulate device conditions

## Why UIDs Are Ephemeral

UIDs come from the current DOM state. When the page changes (navigation, click,
form submit), the DOM rebuilds and previous UIDs become invalid — the element
they pointed to may no longer exist or may have moved. Always `take_snapshot`
again after any interaction that could change the page.

## Use `fill` for Inputs, Not `type_text`

`fill { uid, value }` targets a specific element and clears it first — you know
exactly what you're filling. `type_text { text }` just types at whatever happens
to be focused, which is fragile and can go to the wrong place.

## One Action, Then Re-read

Batching multiple actions without re-reading the page is risky because the first
action may change the DOM, making subsequent UIDs point to wrong elements. Do:
action → snapshot → verify → next action.

## Example: Login Flow

```
1. navigate_page { url: "https://app.example.com/login" }
2. take_snapshot
   → uid=1_7 textbox "Email", uid=1_9 textbox "Password", uid=1_12 button "Sign in"
3. fill { uid: "1_7", value: "user@example.com" }
4. fill { uid: "1_9", value: "secret123" }
5. click { uid: "1_12" }
6. wait_for { text: ["Dashboard"] }
7. take_snapshot
   → now on dashboard, new uids
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

## Troubleshooting

If something goes wrong, read [references/troubleshooting.md](references/troubleshooting.md).
