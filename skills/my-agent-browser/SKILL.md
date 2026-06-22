---
name: my-agent-browser
description: >
  Browser automation guidance and patterns. Trigger this skill BEFORE starting any browser
  interaction (navigating pages, logging in, scraping, filling forms, testing UI) to learn
  the correct workflow and avoid common pitfalls. Also trigger when browser MCP tools
  misbehave: element not found, click does nothing, page crashes, timeout, "target closed",
  snapshot returns empty, or any unexpected browser behavior. This skill teaches you HOW to
  use the browser MCP tools effectively — without it you will hit avoidable failures like
  stale UIDs, heavy-page crashes, and silent navigation failures.
---

# my-agent-browser

Browser automation for AI agents via `chrome-devtools-mcp` MCP server.

## Setup Check

`<skill-dir>` refers to the directory containing this SKILL.md (typically `~/.agents/skills/my-agent-browser/` or `~/.claude/skills/my-agent-browser/` depending on your agent).

If browser MCP tools (`navigate_page`, `take_snapshot`, `click`, `fill`) are not available in your tool list:

1. Install: `npm install -g chrome-devtools-mcp@^1.3.0`
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

- **Performance** (`--categoryPerformance`): trace recording, heap snapshots, memory debugging
- **Network** (`--categoryNetwork`): list/inspect network requests and responses
- **Lighthouse** (`--categoryLighthouse`): run audits (navigation/snapshot, desktop/mobile)
- **Console** (`--categoryConsole`): list/inspect browser console messages
- **Emulation** (`--categoryEmulation`): throttle network/CPU, set geolocation, color scheme

## Key Rules

- **UIDs are ephemeral** — After any navigation or interaction that changes the page, previous UIDs are invalid. Always `take_snapshot` again before the next interaction.
- **Use `fill` for inputs** — It targets a specific element and clears first. `type_text` types at whatever is focused, which is fragile.
- **One action, then re-read** — Don't batch multiple actions without re-snapshotting. The first action may invalidate subsequent UIDs.
- **Heavy pages: use file-based snapshots** — See below.

## Heavy Pages (Critical)

Pages with many DOM nodes (rich-text editors, large tables, chat histories, admin dashboards) will crash or hang if you use `includeSnapshot: true` or `wait_for` on them.

**Symptoms**: browser unresponsive, "target closed", repeated timeouts after injecting content.

**Solution**:
1. Use `includeSnapshot: false` (or omit) for `click`, `fill`, `hover` on heavy pages
2. Save snapshot to file: `take_snapshot { filePath: "/tmp/snap.txt" }`
3. Read only what you need: `tail -100 /tmp/snap.txt` (dialogs/modals are at the end)
4. Close unrelated tabs — each holds its DOM in memory

**When to expect this**: WYSIWYG editors after injecting content, pages with 200+ repeating elements, infinite scroll pages after several scrolls. Switch to file-based workflow proactively before the crash, not after.

## Scraping Patterns

### Simple: snapshot is enough
Navigate → `wait_for` → `take_snapshot` → read text/links from the accessibility tree directly. No JS needed for most structured pages.

### Paginated: prefer URL-based
Loop `navigate_page { url: "...?page=N" }` instead of clicking Next buttons. More reliable, avoids stale UIDs, easy to resume if interrupted.

### Dynamic/lazy-loaded content
`press_key { key: "End" }` to trigger lazy load → `wait_for` known content → `take_snapshot`.

### Complex extraction: `evaluate_script`
When the a11y tree doesn't capture table row/column relationships or deeply nested data, extract with JS:
```
evaluate_script { function: "() => JSON.stringify([...document.querySelectorAll('tr')].map(r => [...r.cells].map(c => c.textContent.trim())))" }
```

### Login-gated content
Option A: persistent profile — log in once with `headless: false`, then reuse `userDataDir`.
Option B: automated — fill credentials via `fill` + `click` + `wait_for`.
Option C: connect to existing session — set `browserUrl` in config.

## Multi-Tab Patterns

- `new_page { url }` opens a tab and makes it active
- After `select_page`, always `take_snapshot` — UIDs from other tabs are invalid
- "Open in new tab, extract, close, return" pattern avoids losing your place on listing pages
- Each tab is independent — snapshots, UIDs, and page state don't cross tabs

## JavaScript Execution Tips

- `evaluate_script` runs in the browser page context (has `document`, `window`, page libraries)
- Return values must be JSON-serializable — use `JSON.stringify()` for objects/arrays
- Can return Promises (useful for polling/waiting patterns)
- DOM changes persist — after modifying the page, retake snapshot for fresh UIDs
- Common uses: scroll, extract structured data, remove overlays, trigger lazy load, read computed styles

## Error Recovery

- Element not found after click → page changed, retake snapshot, find new UID
- `wait_for` timeout → page didn't load expected content, take snapshot to see actual state
- Chrome crashed / "target closed" → auto-relaunched by start-mcp.js, re-navigate to your URL
- Anti-bot detection → add `--disable-blink-features=AutomationControlled` to `extraArgs` in config

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

## Troubleshooting Quick Reference

| Problem | Cause | Fix |
|---------|-------|-----|
| Click/fill does nothing | Stale UIDs | `take_snapshot` again, use fresh UIDs |
| Element not in snapshot | Below fold / iframe / async | Scroll first, or `wait_for`, or `evaluate_script` to check |
| `wait_for` timeout | Text never appeared | `take_snapshot` to see actual state |
| Chrome not starting | Not installed or port in use | Check `which google-chrome`, check port conflict |
| Snapshot empty/minimal | JS-rendered content not ready | `wait_for` before snapshot |
| Memory overflow / crash | Heavy DOM | File-based snapshots (see above) |
| Bot detection | Automation flags detected | Add anti-detection `extraArgs` in config |

For detailed troubleshooting: [references/troubleshooting.md](references/troubleshooting.md)
For network debugging workflows: [references/network-debugging.md](references/network-debugging.md)
For advanced scraping patterns: [references/scraping-patterns.md](references/scraping-patterns.md)

## Domain-Specific Workflows

- **Academic paper download** (CNKI, Google Scholar, MDPI): [references/domain/academic-paper-download.md](references/domain/academic-paper-download.md)
