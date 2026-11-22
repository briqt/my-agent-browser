# JavaScript Execution (`eval`)

`my-agent-browser eval` (alias for `evaluate_script`) executes JavaScript inside the
browser page context (`window`, `document`, and site globals), not in Node.js.

## Basic Usage

The function argument must evaluate to a JavaScript **function expression** (`() => ...`
or `async () => ...`), and its return value must be JSON-serializable. Use `--raw` when
piping the return value to `jq` or shell variables:

```bash
# Get page title
my-agent-browser eval 1 "() => (document.title)" --raw

# Get current URL
my-agent-browser eval 1 "() => (window.location.href)" --raw

# Read element text
my-agent-browser eval 1 "() => (document.querySelector('h1')?.textContent?.trim() ?? null)" --raw
```

Pass element UIDs from `snap` as function arguments with `--args`:

```bash
my-agent-browser eval 1 "(el) => el.innerText" --args 1_4 --raw
```

## Scrolling & Data Extraction

```bash
# Scroll to bottom
my-agent-browser eval 1 "() => { window.scrollTo(0, document.body.scrollHeight); return window.scrollY; }" --raw

# Scroll specific element into view
my-agent-browser eval 1 "() => { document.querySelector('#target')?.scrollIntoView({ block: 'center' }); return true; }" --raw

# Extract table rows as JSON and pipe to jq
my-agent-browser eval 1 "() => [...document.querySelectorAll('table tr')].map(row => [...row.querySelectorAll('td, th')].map(c => c.textContent.trim()))" --raw | jq .

# Extract all links
my-agent-browser eval 1 "() => [...document.querySelectorAll('a[href]')].map(a => ({ text: a.textContent.trim(), href: a.href })).filter(x => x.text)" --raw | jq .

# Read all form values
my-agent-browser eval 1 "() => Object.fromEntries([...document.querySelectorAll('input, select, textarea')].map(el => [el.name || el.id, el.value]))" --raw
```

## DOM Manipulation & Bounded Polling

```bash
# Remove blocking overlay/modal, then retake snapshot for fresh UIDs
my-agent-browser eval 1 "() => { document.querySelector('.modal-overlay')?.remove(); return 'cleaned'; }" --raw
my-agent-browser snap 1

# Set native <select> value and trigger framework listeners (useful on macOS where press_key cannot drive OS <select> popups)
my-agent-browser eval 1 "() => { const s = document.querySelector('select#kind'); s.value = 'title'; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; }" --raw

# Bounded async poll on heavy pages (cheaper than repeated full accessibility snapshots)
my-agent-browser eval 1 "async () => { const deadline = Date.now() + 10000; while (Date.now() < deadline) { const el = document.querySelector('.results'); if (el) return el.textContent.trim(); await new Promise(r => setTimeout(r, 200)); } throw new Error('results did not appear within 10s'); }" --raw
```

## Important Rules

- **Do not reload inside an async `eval`**: Calling `location.reload()` and awaiting inside the same script destroys its execution context. Run `my-agent-browser reload <pageId>` first, then `eval` in a separate command.
- **No TypeScript syntax**: Pass valid JS (`() => window.__DATA__`), never `(window as any).__DATA__`.
- **Classic scripts & local files**:
  - `--source-path /path/to/fn.js` loads a JS file; `--file-path /tmp/out.json` writes output to disk.
  - `--format script` evaluates classic top-level JS statements instead of invoking a function.
  - Inline functions automatically receive `stealth.evaluateScript` stack-trace hiding; `--format script` and `--source-path` run unmodified upstream.
