# Scraping Patterns

Best practices for extracting data from web pages using browser automation tools.

## Pattern 1: Simple Page Scrape

Navigate to a page, take a snapshot, and extract information from the accessibility tree.

```
1. navigate_page { url: "https://news.example.com" }
2. wait_for { text: ["Latest News"] }
3. take_snapshot
   → Read the tree structure to find article titles, links, dates
   → The accessibility tree gives you text content and link URLs directly
```

Best for: pages with well-structured content (articles, product listings, directories).

The accessibility tree already contains text content and link URLs — no need for
`evaluate_script` in most cases. Just read the snapshot output.

## Pattern 2: Paginated Data

Loop through pages, extracting data from each one.

```
1. navigate_page { url: "https://shop.example.com/products?page=1" }
2. wait_for { text: ["Products"] }
3. take_snapshot → extract product names, prices, links from tree
4. take_snapshot → find "Next" button uid
5. click { uid: "1_99" }  — click Next
6. wait_for { text: ["Page 2"] }  — or wait for content change
7. take_snapshot → extract page 2 data
8. Repeat until no "Next" button in snapshot
```

Alternative — URL-based pagination (more reliable):

```
for page in 1, 2, 3, ...:
  1. navigate_page { url: "https://shop.example.com/products?page={page}" }
  2. wait_for { text: ["Products"] }
  3. take_snapshot → extract data
  4. If snapshot shows "No results" or page is empty → stop
```

URL-based pagination avoids stale UID issues and is easier to resume if interrupted.

## Pattern 3: Dynamic Content

For pages that load content asynchronously (infinite scroll, lazy loading, AJAX tabs):

```
1. navigate_page { url: "https://app.example.com/feed" }
2. wait_for { text: ["Feed"] }
3. take_snapshot → extract visible items
4. press_key { key: "End" }  — scroll to bottom to trigger lazy load
5. wait_for { text: ["Loading complete"] }  — or a known item
6. take_snapshot → extract newly loaded items
```

For content behind tabs or accordions:

```
1. navigate_page { url: "https://example.com/product/123" }
2. take_snapshot → find tab uid
3. click { uid: "1_30" }  — click "Specifications" tab
4. wait_for { text: ["Weight"] }  — wait for tab content
5. take_snapshot → extract specification data
```

## Pattern 4: Complex Extraction with evaluate_script

When the accessibility tree doesn't give you the structure you need (e.g., table
data with row/column relationships, or deeply nested data), use JavaScript:

### Extract a Table

```
evaluate_script { function: "() => { const rows = document.querySelectorAll('table tbody tr'); return Array.from(rows).map(row => { const cells = row.querySelectorAll('td'); return { name: cells[0]?.textContent.trim(), price: cells[1]?.textContent.trim(), stock: cells[2]?.textContent.trim() }; }); }" }
```

### Extract All Links with Context

```
evaluate_script { function: "() => { return Array.from(document.querySelectorAll('a[href]')).map(a => ({ text: a.textContent.trim(), href: a.href, parent: a.closest('article,section,div')?.className || '' })).filter(l => l.text); }" }
```

### Extract Structured Data (JSON-LD, meta tags)

```
evaluate_script { function: "() => { const ld = document.querySelector('script[type=\"application/ld+json\"]'); return ld ? JSON.parse(ld.textContent) : null; }" }
```

### Extract Computed Styles or Dimensions

```
evaluate_script { function: "() => { const el = document.querySelector('.hero-image'); const rect = el.getBoundingClientRect(); return { width: rect.width, height: rect.height, visible: rect.height > 0 }; }" }
```

Tips for `evaluate_script`:
- The function must be a string containing a JavaScript function expression.
- Return JSON-serializable data (no DOM nodes, no circular references).
- Use `() => { ... }` arrow function syntax.
- Keep scripts focused — extract one type of data per call.

## Anti-Detection

Sites may block automated browsers. Configure anti-detection in `~/.my-agent-browser/config.json`:

```json
{
  "browser": {
    "extraArgs": [
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
      "--disable-dev-shm-usage"
    ]
  }
}
```

Additional measures:
- Use a real `userDataDir` with existing cookies/history (looks less like a fresh bot profile).
- Set a realistic user agent via the Emulation tools.
- Add random delays between actions (the agent naturally does this).
- Use a residential proxy via `browser.proxy` config.

## Handling Login-Gated Content

### Option A: Persistent Profile (Recommended)

Log in once manually, then reuse the profile:

1. Set `"headless": false` in config temporarily
2. Ask the agent to navigate to the login page
3. Log in manually in the visible browser
4. Set `"headless": true` again — cookies persist in `userDataDir`

### Option B: Automated Login

```
1. navigate_page { url: "https://app.example.com/login" }
2. take_snapshot → find email/password fields
3. fill { uid: "1_5", value: "user@example.com" }
4. fill { uid: "1_7", value: "password123" }
5. click { uid: "1_10" }  — submit
6. wait_for { text: ["Dashboard"] }
7. — Now proceed with scraping authenticated pages
```

### Option C: Connect to Existing Session

If you have a Chrome instance already logged in:

```json
{
  "browser": {
    "browserUrl": "http://127.0.0.1:9222"
  }
}
```

## Rate Limiting and Politeness

### Respect the Site

- Don't hammer a site with rapid-fire requests. The natural pace of
  snapshot → process → next action provides some built-in delay.
- For bulk scraping, add explicit waits between page loads if needed.
- Check `robots.txt` — some paths are explicitly disallowed.
- Respect rate limit headers (429 status, Retry-After header).

### Handling Rate Limits

If you get blocked or rate-limited:

```
1. navigate_page { url: "https://example.com/page" }
2. take_snapshot
   → If snapshot shows "Rate limited" or "Please wait":
3. wait_for { text: ["expected content"] }  — with longer timeout
   → Or navigate to a different section first, come back later
```

### Batch Size

For large scraping jobs:
- Process 10-20 pages, then pause and verify data quality.
- If the site starts returning CAPTCHAs or blocks, stop and reassess.
- Consider whether an API exists — always prefer official APIs over scraping.

## Complete Example: Scrape Product Catalog

```
1. navigate_page { url: "https://shop.example.com/category/electronics" }
2. wait_for { text: ["Electronics"] }
3. take_snapshot
   → Extract: product names, prices, ratings from the tree
   → Find: pagination controls

4. — For each product that needs details:
   click { uid: "1_15" }  — click product link
   wait_for { text: ["Add to Cart"] }
   take_snapshot → extract full description, specs, images
   evaluate_script { function: "() => document.querySelector('.price').dataset.raw" }
   navigate_page { url: "https://shop.example.com/category/electronics" }
   wait_for { text: ["Electronics"] }
   take_snapshot → get fresh UIDs for next product

5. — Pagination:
   take_snapshot → find "Next page" button
   click { uid: "1_50" }
   wait_for { text: ["Page 2"] }
   take_snapshot → repeat extraction
```
