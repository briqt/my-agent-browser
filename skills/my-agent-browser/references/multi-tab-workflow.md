# Multi-Tab & Multi-Agent (`owner`) Workflow

`my-agent-browser` routes every page-scoped command by explicit numeric **`pageId`**,
and tracks per-tab **`owner`** locks so multiple AI agents can share one logged-in
Chrome profile safely without stepping on each other's tabs or closing the browser mid-task.

## 1. Opening, Listing & Closing Tabs

```bash
# Open a dedicated tab locked to your task/agent owner
my-agent-browser open "https://example.com" --owner research-agent

# List all open tabs across the shared browser
my-agent-browser pages
# → 1: Home (https://app.example.com/)  idle=14m
# → 2: Example Domain (https://example.com/) [selected]  owner=research-agent  idle=2s

# Work directly on pageId 2 (no select-page needed!)
my-agent-browser snap 2
my-agent-browser click 2 1_5

# Close ONLY your own tab when finished
my-agent-browser close-page 2 --owner research-agent
```

- `pageId` is the integer before `:` in `pages`. IDs are never renumbered when another tab closes.
- Pass `pageId` directly on every page-scoped command (`snap 2`, `click 2 ...`, or `--page 2`).
- `select-page 2` only changes logical selection; pass `--bring-to-front` only when you intentionally want OS/GUI tab focus.
- Chrome does not allow closing the last remaining open tab.

### Background New Tabs (`mcp.backgroundNewPages`)

Set `{ "mcp": { "backgroundNewPages": true } }` in `config.json` (followed by `my-agent-browser restart`)
to open new tabs in the background by default when neither `--background` nor `--foreground` is passed:

```bash
my-agent-browser open "https://example.com"               # uses config default
my-agent-browser open "https://example.com" --background  # explicit background
my-agent-browser open "https://example.com" --foreground  # explicit foreground
```

## 2. Multi-Agent Ownership (`--owner` / `MY_AGENT_BROWSER_OWNER`)

Every agent running under the same OS user talks to the same daemon. Follow these rules:

1. **Tag your tabs**: Pass `--owner <unique-name>` on `open` (or set `export MY_AGENT_BROWSER_OWNER=<unique-name>` once in your shell workflow). Tabs opened without an owner remain unlocked (`owner=""`).
2. **Lock or unlock existing tabs**:
   ```bash
   my-agent-browser claim 1 --owner agent-a
   my-agent-browser release 1 --owner agent-a
   ```
3. **Read-only commands never block**: Any agent can run `pages`, `status`, `snap`, `shot`, `console`, or `network` to inspect state.
4. **Mutations respect locks**: `goto`, `click`, `fill`, `fill-form`, `eval`, `batch`, `close-page`, etc. on an owned tab fail immediately if the caller's `--owner` does not match, unless `--force` is explicitly authorized by the user.
5. **Check before stopping or restarting the browser**:
   ```bash
   my-agent-browser status
   my-agent-browser status --json   # check canStopSafely and activeOwners
   ```
   `my-agent-browser stop` and `restart` automatically sync live Chrome tabs and **refuse** to close the browser if another owner still holds open tab(s) or a command is in flight (override only with `--force` when instructed by the user). Normally, just `close-page` your own tab and let `browser.idleTimeout` reclaim Chrome when idle.

## 3. "Open in New Tab, Extract, Close" Listing Pattern

Avoid losing scroll/pagination state on a search or directory page:

```bash
# 1. Keep listing tab on pageId 1; extract detail URLs
my-agent-browser eval 1 "() => [...document.querySelectorAll('a.item')].map(a => a.href)" --raw

# 2. Open detail URL in a separate tab, extract, and close it
my-agent-browser open "https://example.com/item/42" --background --owner scraper
# → suppose new pageId is 3
my-agent-browser snap 3
my-agent-browser close-page 3 --owner scraper

# 3. Listing tab (pageId 1) is untouched
```
