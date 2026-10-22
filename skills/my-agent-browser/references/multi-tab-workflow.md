# Multi-Tab Workflow

chrome-devtools-mcp routes page-scoped tools by **pageId**. Get ids from
`list_pages` or `new_page`, then pass that pageId on every `take_snapshot` /
`click` / `fill` / `evaluate_script` / `wait_for` / `navigate_page` call.
Pass `pageId` directly; `select_page` is not required for routing. It changes
logical selection and only actively brings the tab to front with `bringToFront: true`.
Logical selection is not OS foreground focus.

## Opening New Tabs

```
new_page { url: "https://example.com" }
```

The response includes the new tab's pageId. Use that id for all following
calls on this tab. A snapshot is often returned so you can interact immediately.

Blank tab (navigate later):

```
new_page { url: "about:blank" }
```

### Background new tabs (wrapper 1.3.0)

The default config is `{ "mcp": { "backgroundNewPages": false } }`.
Omitted or `false` leaves upstream `new_page` behavior entirely unchanged. To
opt in, merge this into your config and restart the MCP session:

```json
{ "mcp": { "backgroundNewPages": true } }
```

Only strict boolean `true` supplies `background: true` when a `new_page` call
does not provide `background`. Explicit call values always win:

```
new_page { url: "https://example.com" }                     # inherits wrapper setting
new_page { url: "https://example.com", background: true }   # explicitly background
new_page { url: "https://example.com", background: false }  # explicit upstream foreground behavior
```

This is wrapper config, not an upstream CLI flag; do not put it in `mcp.flags`.
It applies in lazy, eager and direct (`browserUrl`) modes, regardless of stealth
settings. It does not guarantee focus behavior for Chrome's first GUI launch,
website `window.open` popups, or `select_page` with `bringToFront: true`.

## Listing Open Tabs

```
list_pages
```

Returns a numbered list like:

```
## Pages
1: Example Domain (https://example.com/) [selected]
2: GitHub (https://github.com/)
```

The number before the colon is `pageId`. Ids stay unique across reconnects —
do not assume they are 0-based indices or that they pack densely after a close.

## Switching Tabs

To work on a tab, pass its pageId directly; no `select_page` is needed:

```
take_snapshot { pageId: 2 }
```

If logical selection is needed, use `select_page { pageId: 2 }`. When
`bringToFront` is omitted or `false`, it does not actively bring the tab to front.
To explicitly request bringing it to front:

```
select_page { pageId: 2, bringToFront: true }
```

Logical selection (including `[selected]` in `list_pages`) is not OS foreground
focus. Later page-scoped calls still need `pageId`.

## Closing Tabs

```
close_page { pageId: 2 }
```

The last remaining page cannot be closed. After closing, `list_pages` to see
what is left — remaining ids are **not** renumbered.

## Important: Tab-Scoped State

- **Snapshots** are per-tab. A snapshot from pageId 1 does not apply to pageId 2.
- **UIDs** are per-tab and per-snapshot. Never use a UID from one tab on another.
- Targeting is by pageId, not by "whatever is selected". After opening a second
  tab, keep using each tab's own pageId.

## Workflow: Compare Two Pages Side by Side

```
# Tab A
new_page { url: "https://site-a.com/product" }
→ pageId A (e.g. 1)
take_snapshot { pageId: 1 }
# Extract data from page A

# Tab B
new_page { url: "https://site-b.com/product" }
→ pageId B (e.g. 2)
take_snapshot { pageId: 2 }
# Extract data from page B

# Back to A — pass A's pageId directly; no select_page needed
take_snapshot { pageId: 1 }
```

## Workflow: Open Link in New Tab, Extract Data, Return

```
# Listing tab
list_pages → listingId (e.g. 1)
take_snapshot { pageId: 1 }

evaluate_script { pageId: 1, function: "() => (document.querySelector('a.target-link').href)" }

new_page { url: "<the href value>" }
→ detailId (e.g. 2)
take_snapshot { pageId: 2 }
# Extract what you need

close_page { pageId: 2 }
take_snapshot { pageId: 1 }
```

## Workflow: Process Multiple Links from a List

```
# Start on the listing page
list_pages → listingId
take_snapshot { pageId: listingId }

# For each link:
new_page { url: "<link-url>" }
→ detailId
take_snapshot { pageId: detailId }
# Extract data
close_page { pageId: detailId }

# Listing tab is unchanged — retake snapshot if its DOM may have changed
take_snapshot { pageId: listingId }
```

This pattern never navigates away from the listing page, so you do not lose
your place or need to re-navigate.
