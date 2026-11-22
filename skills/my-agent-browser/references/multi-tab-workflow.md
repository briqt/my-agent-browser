# Multi-Tab & Multi-Agent (`owner`) Workflow

`my-agent-browser` routes every page-scoped command by explicit numeric **`pageId`**, opens all new tabs in the background without stealing focus, and tracks per-tab **`owner`** locks so multiple agents can share one Chrome profile safely.

## 1. Opening, Listing & Closing Tabs

```bash
# Open a dedicated background tab and capture its pageId
ID=$(my-agent-browser open "https://example.com" --owner research-agent --raw)

# List all open tabs across the shared browser
my-agent-browser pages
# → 1: about:blank (about:blank)
# → 2: Example Domain (https://example.com/) [selected]  owner=research-agent  idle=2s

# Work directly on that pageId (no select-page needed)
my-agent-browser snap "$ID"
my-agent-browser click "$ID" 1_5

# Close ONLY your own tab when finished
my-agent-browser close-page "$ID" --owner research-agent
```

- `pageId` is the integer before `:` in `pages` and never renumbers when another tab closes.
- Pass `pageId` directly on every page-scoped command (`snap 2`, `click 2 ...`, or `--page 2`).
- `select-page 2` only changes logical selection; pass `--bring-to-front` only when you intentionally want OS/GUI focus.
- Chrome cannot close the last remaining open tab, but `close-page` still clears your `owner` lock so `stop` / `restart` is never blocked by a stale lock.

## 2. Multi-Agent Ownership (`--owner` / `MY_AGENT_BROWSER_OWNER`)

1. **Tag your tabs**: Pass `--owner <unique-name>` on `open` (or `export MY_AGENT_BROWSER_OWNER=<unique-name>`). Tabs opened without an owner remain unlocked.
2. **Lock or unlock existing tabs**:
   ```bash
   my-agent-browser claim 1 --owner agent-a
   my-agent-browser release 1 --owner agent-a
   ```
3. **Read-only commands never block**: `pages`, `status`, `snap`, `shot`, `console`, `network`, `wait-for`, `get_css_styles`, `performance_analyze_insight`.
4. **Mutations respect locks**: `goto`, `click`, `fill`, `fill-form`, `eval`, `close-page`, etc. on an owned tab fail if `--owner` does not match, unless `--force` is explicitly authorized.
5. **Check before stopping or restarting**:
   ```bash
   my-agent-browser status --json   # inspect canStopSafely and activeOwners
   ```
   `stop` and `restart` refuse while another owner holds open tab(s) or a command is in flight (override only with `--force`). Normally, just `close-page` your own tab and let `browser.idleTimeout` reclaim Chrome when idle.

## 3. "Open in New Tab, Extract, Close" Listing Pattern

Avoid losing scroll/pagination state on a search or directory page:

```bash
# 1. Keep listing tab on pageId 1; extract detail URLs
my-agent-browser eval 1 "() => [...document.querySelectorAll('a.item')].map(a => a.href)" --raw

# 2. Open detail URL in a separate background tab, extract, and close it
DETAIL=$(my-agent-browser open "https://example.com/item/42" --owner scraper --raw)
my-agent-browser snap "$DETAIL"
my-agent-browser close-page "$DETAIL" --owner scraper
```
