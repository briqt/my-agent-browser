---
name: my-agent-browser
description: >
  Browser automation via chrome-devtools-mcp. Control Chrome: navigate pages, take accessibility
  snapshots with uid refs, click/fill/hover elements, manage tabs, take screenshots, execute JS.
  Use when the user needs to interact with websites, fill forms, scrape data, test web apps,
  automate browser tasks, or do anything requiring a real browser. Trigger on: browser, chrome,
  navigate, snapshot, screenshot, click, type, web page, open URL, browse, visit website,
  login to site, fill form, scrape, web automation, test UI.
---

# my-agent-browser

Browser automation for AI agents via `chrome-devtools-mcp` MCP server.

## Setup

The MCP server is configured in your agent settings. It auto-starts Chrome and
connects via CDP. No manual browser management needed for most workflows.

If Chrome isn't running, use the lifecycle script:
```bash
~/.my-agent-browser/scripts/browser.sh start
```

## Core Workflow

1. **Navigate** to a page using `navigate_page`
2. **Snapshot** the page using `take_snapshot` to see elements with `uid` refs
3. **Interact** using `click`, `fill`, `press_key` with the uid from snapshot
4. **Re-snapshot** after every interaction — uids change when the page changes

## Reading Snapshots

`take_snapshot` returns an accessibility tree like:

```
uid=1_0 RootWebArea "Sign in" url="https://example.com/login"
  uid=1_5 heading "Sign in" level="1"
  uid=1_7 textbox "Email" focusable required
  uid=1_9 textbox "Password" required
  uid=1_12 button "Sign in"
  uid=1_14 link "Forgot password?" url="..."
```

Each `uid=X_Y` is a stable reference for that snapshot. Use it directly in
`click`, `fill`, `hover`, etc.

## Available Tools

### Navigation
- `navigate_page { url }` — Go to URL
- `new_page { url }` — Open new tab
- `list_pages` — List all tabs (shows which is selected)
- `select_page { pageId }` — Switch to tab
- `close_page { pageId }` — Close tab

### Reading
- `take_snapshot` — Get page accessibility tree with uid refs
- `take_screenshot` — Capture page as image

### Interaction
- `click { uid }` — Click element
- `fill { uid, value }` — Fill input field (clears first)
- `fill_form { elements: [{uid, value}] }` — Fill multiple fields at once
- `type_text { text }` — Type text at current focus (no clear)
- `press_key { key }` — Press key (Enter, Tab, Escape, ArrowDown, etc.)
- `hover { uid }` — Hover over element
- `drag { from_uid, to_uid }` — Drag element
- `upload_file { uid, filePath }` — Upload file to input
- `handle_dialog { action }` — Accept/dismiss alert/confirm/prompt

### Utility
- `evaluate_script { function }` — Execute JavaScript
- `wait_for { text[] }` — Wait for text to appear on page
- `resize_page { width, height }` — Change viewport size

## Important Rules

1. **UIDs are ephemeral.** After any page change (navigation, click, form submit),
   previous uids are invalid. Always `take_snapshot` again before interacting.

2. **Use `fill` not `type_text` for inputs.** `fill { uid, value }` targets a
   specific field and clears it first. `type_text` just types at whatever is focused.

3. **Wait for page loads.** After navigation or form submit, use `wait_for` with
   expected text before taking a snapshot.

4. **One action at a time.** Don't batch multiple clicks. Do: click → snapshot →
   verify → next action.

## Example: Login Flow

```
1. navigate_page { url: "https://app.example.com/login" }
2. take_snapshot
   → see: uid=1_7 textbox "Email", uid=1_9 textbox "Password", uid=1_12 button "Sign in"
3. fill { uid: "1_7", value: "user@example.com" }
4. fill { uid: "1_9", value: "secret123" }
5. click { uid: "1_12" }
6. wait_for { text: ["Dashboard"] }
7. take_snapshot
   → now on dashboard, new uids
```

## Example: Search and Extract

```
1. navigate_page { url: "https://google.com" }
2. take_snapshot
   → uid=1_5 textbox "Search"
3. fill { uid: "1_5", value: "AI agents" }
4. press_key { key: "Enter" }
5. wait_for { text: ["results"] }
6. take_snapshot
   → read results from snapshot text
```

## Troubleshooting

- **"No pages found"** → Use `new_page { url: "about:blank" }` to create one
- **Click does nothing** → Page may have changed. Re-snapshot and use new uid.
- **Element not in snapshot** → It may be off-screen or in an iframe. Try
  `evaluate_script` to check, or scroll first.
- **Timeout on wait_for** → Page may not have loaded. Check with `take_snapshot`
  to see current state.

## Chrome Lifecycle (manual)

Usually handled automatically by the MCP server wrapper. For manual control:

```bash
# Start Chrome
~/.my-agent-browser/scripts/browser.sh start

# Check status
~/.my-agent-browser/scripts/browser.sh status

# Stop Chrome
~/.my-agent-browser/scripts/browser.sh stop
```

## Configuration

Edit `~/.my-agent-browser/config.json`:

```json
{
  "browser": {
    "headless": true,
    "noSandbox": true,
    "cdpPort": 19333,
    "userDataDir": "~/.my-agent-browser/profiles/default/user-data",
    "proxy": "http://127.0.0.1:3067",
    "extraArgs": ["--disable-blink-features=AutomationControlled"]
  }
}
```

Key settings:
- `headless`: false to see the browser window (debugging)
- `proxy`: HTTP proxy for all browser traffic
- `userDataDir`: where cookies/logins persist between sessions
- `extraArgs`: additional Chrome flags
