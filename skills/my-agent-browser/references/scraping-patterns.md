# Scraping Patterns

Best practices for reliable data extraction with `my-agent-browser`.

## Pattern 1: Snapshot-First Extraction (Default)

The accessibility tree already includes visible text and link `url="..."` attributes —
most structured pages need zero custom JavaScript:

```bash
my-agent-browser open "https://news.example.com" --owner scraper
# → suppose pageId is 2
my-agent-browser wait-for 2 "Latest"
my-agent-browser snap 2
```

For heavy pages (200+ items), write the snapshot to disk and filter with standard Unix tools:

```bash
my-agent-browser snap 2 /tmp/news.txt
grep 'link "' /tmp/news.txt | head -n 40
```

## Pattern 2: URL-Based Pagination (Preferred over Clicking "Next")

Navigating directly to `?page=N` avoids stale UIDs and resumes cleanly after interruption:

```bash
for page in 1 2 3; do
  my-agent-browser goto 2 "https://shop.example.com/products?page=${page}"
  my-agent-browser wait-for 2 "Products"
  my-agent-browser snap 2 "/tmp/products-p${page}.txt"
done
```

## Pattern 3: Lazy-Loaded / Infinite-Scroll Content

```bash
my-agent-browser press 2 End
my-agent-browser wait-for 2 "Load more"
my-agent-browser snap 2 /tmp/feed.txt
```

## Pattern 4: Structured Table / JSON-LD Extraction (`eval --raw`)

When row/column relationships or hidden metadata (`application/ld+json`) aren't preserved in the a11y tree:

```bash
my-agent-browser eval 2 "() => { const rows = document.querySelectorAll('table tbody tr'); return Array.from(rows).map(r => { const c = r.querySelectorAll('td'); return { name: c[0]?.textContent.trim(), price: c[1]?.textContent.trim() }; }); }" --raw | jq .

my-agent-browser eval 2 "() => { const ld = document.querySelector('script[type=\"application/ld+json\"]'); return ld ? JSON.parse(ld.textContent) : null; }" --raw | jq .
```

## Login-Gated Sites

1. **Persistent Profile (Recommended)**:
   - Temporarily run headed (`my-agent-browser restart --headed` or `"headless": false` in `config.json`), log in manually once, then switch back to headless (`my-agent-browser restart --headless`). Cookies stay in `~/.config/agent-skills/my-agent-browser/user-data`.
2. **Automated Form Login**:
   - Observe UIDs with `snap`, then run `fill-form` + `click` (or `batch ... --snapshot final`).
3. **Existing External Browser**:
   - Launch your own Chrome with `--remote-debugging-port=9222` and set `"browserUrl": "http://127.0.0.1:9222"` in `config.json`.

## Anti-Detection Order of Operations

1. **Exit IP & pacing** (`browser.proxy`, natural delays between pages).
2. **WebGL renderer** (verify real GPU or `--ignore-gpu-blocklist`; avoid bare `--disable-gpu`).
3. **Prefer `snap` + `click` / `fill` over `eval`** (native CDP input is invisible to page JS).
4. **Headed mode** (`--headed` / `"headless": false`) for sites screening `HeadlessChrome`.
See [anti-detection.md](anti-detection.md) for full measurements.
