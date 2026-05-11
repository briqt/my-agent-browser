# Multi-Tab Workflow

## Opening New Tabs

Use `new_page` to open a tab and navigate to a URL:

```
new_page { url: "https://example.com" }
```

The new tab becomes the active tab automatically. A snapshot is returned so you
can immediately interact with the page.

To open a blank tab (useful when you want to navigate later):

```
new_page { url: "about:blank" }
```

## Listing Open Tabs

Use `list_pages` to see all open tabs with their index and URL:

```
list_pages
```

Returns a list like:
```
[0] https://example.com - "Example Domain"
[1] https://github.com - "GitHub"
[2] about:blank
```

The currently active tab is marked in the output.

## Switching Tabs

Use `select_page` with the tab index from `list_pages`:

```
select_page { index: 1 }
```

After switching, take a snapshot to see the current state of that tab:

```
take_snapshot
```

## Closing Tabs

Use `close_page` to close the current tab:

```
close_page
```

After closing, the browser switches to another open tab. Use `list_pages` to
confirm which tab is now active.

## Important: Tab-Scoped State

Each tab has its own independent state:

- **Snapshots** are per-tab. A snapshot from tab 0 does not apply to tab 1.
- **UIDs** are per-tab and per-snapshot. Never use a UID from one tab to
  interact with another tab.
- **After switching tabs**, always `take_snapshot` before clicking or filling
  elements — the UIDs from your previous tab are invalid in the new context.

## Workflow: Compare Two Pages Side by Side

When you need to compare content across two pages (e.g., comparing prices,
verifying data between source and destination):

```
# Open first page
navigate_page { url: "https://site-a.com/product" }
take_snapshot
# Extract data from page A (note it down)

# Open second page in new tab
new_page { url: "https://site-b.com/product" }
take_snapshot
# Extract data from page B

# Switch back to first tab if needed
select_page { index: 0 }
take_snapshot
```

## Workflow: Open Link in New Tab, Extract Data, Return

When you want to follow a link without losing your place on the current page:

```
# You're on a page with a list of links
take_snapshot
# Note the current tab index (e.g., 0)

# Open the link target in a new tab instead of clicking it
# First, get the href via evaluate_script if needed:
evaluate_script { function: "document.querySelector('a.target-link').href" }

# Open in new tab
new_page { url: "<the href value>" }
take_snapshot
# Extract what you need from the new tab

# Close the new tab and return
close_page
# You're back on the original tab
take_snapshot
```

## Workflow: Process Multiple Links from a List

When you need to visit each link in a list and extract data:

```
# Start on the listing page (tab 0)
take_snapshot
# Identify all links to process

# For each link:
new_page { url: "<link-url>" }
take_snapshot
# Extract data
close_page

# Back on listing page — snapshot is stale, retake if DOM may have changed
take_snapshot
```

This pattern avoids navigation away from the listing page, so you never lose
your place or need to re-navigate.
