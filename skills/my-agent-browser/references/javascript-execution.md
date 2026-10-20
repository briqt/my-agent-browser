# JavaScript Execution with evaluate_script

`evaluate_script` runs JavaScript in the page context (the browser's runtime),
not in Node.js. It has access to `document`, `window`, and all page globals.
Always pass `pageId` from `list_pages` or `new_page`.

## Basic Usage

The `function` parameter must evaluate to a JavaScript function, such as `() => document.title`. The tool invokes it and awaits its return value.

### Get page title

```
evaluate_script { pageId, function: "() => (document.title)" }
```

### Get current URL

```
evaluate_script { pageId, function: "() => (window.location.href)" }
```

### Get element text content

```
evaluate_script { pageId, function: "() => (document.querySelector('h1').textContent)" }
```

### Get an attribute value

```
evaluate_script { pageId, function: "() => (document.querySelector('meta[name=description]').content)" }
```

## Scrolling

### Scroll to bottom of page

```
evaluate_script { pageId, function: "() => (window.scrollTo(0, document.body.scrollHeight))" }
```

### Scroll by a specific amount (pixels)

```
evaluate_script { pageId, function: "() => (window.scrollBy(0, 500))" }
```

### Scroll element into view

```
evaluate_script { pageId, function: "() => (document.querySelector('#target').scrollIntoView({ behavior: 'smooth' }))" }
```

### Get current scroll position

```
evaluate_script { pageId, function: "() => (JSON.stringify({ x: window.scrollX, y: window.scrollY }))" }
```

## Data Extraction

### Extract table data as JSON

```
evaluate_script { pageId, function: "() => (JSON.stringify([...document.querySelectorAll('table tr')].map(row => [...row.querySelectorAll('td, th')].map(cell => cell.textContent.trim()))))" }
```

### Get all links on the page

```
evaluate_script { pageId, function: "() => (JSON.stringify([...document.querySelectorAll('a[href]')].map(a => ({ text: a.textContent.trim(), href: a.href }))))" }
```

### Get form field values

```
evaluate_script { pageId, function: "() => (JSON.stringify(Object.fromEntries([...document.querySelectorAll('input, select, textarea')].map(el => [el.name || el.id, el.value]))))" }
```

### Count elements matching a selector

```
evaluate_script { pageId, function: "() => (document.querySelectorAll('.item').length)" }
```

### Extract structured data (e.g., product cards)

```
evaluate_script { pageId, function: "() => (JSON.stringify([...document.querySelectorAll('.product-card')].map(card => ({ title: card.querySelector('.title')?.textContent?.trim(), price: card.querySelector('.price')?.textContent?.trim(), url: card.querySelector('a')?.href }))))" }
```

## DOM Manipulation

### Trigger a click event programmatically

```
evaluate_script { pageId, function: "() => (document.querySelector('button.load-more').click())" }
```

### Set an attribute

```
evaluate_script { pageId, function: "() => (document.querySelector('input#email').value = 'test@example.com')" }
```

### Remove an element (e.g., dismiss a modal overlay)

```
evaluate_script { pageId, function: "() => (document.querySelector('.modal-overlay')?.remove())" }
```

### Dispatch a custom event

```
evaluate_script { pageId, function: "() => (document.querySelector('#app').dispatchEvent(new Event('change', { bubbles: true })))" }
```

## Waiting for Conditions

### Wait for an element with a bounded poll

Use `wait_for { pageId, text: ["expected text"] }` for small pages. For large pages,
probe a specific element rather than repeatedly serializing the full accessibility tree:

```
evaluate_script { pageId, function: "async () => { const deadline = Date.now() + 10000; while (Date.now() < deadline) { const el = document.querySelector('.results'); if (el) return el.textContent; await new Promise(resolve => setTimeout(resolve, 200)); } throw new Error('results did not appear within 10s'); }" }
```

Navigate or reload in a separate `navigate_page` call before polling. A navigation
inside the same asynchronous script can destroy its execution context.

## Important Notes

- **Page context only**: You have access to `document`, `window`, DOM APIs,
  and any libraries the page has loaded (jQuery, React, etc.). You do NOT have
  access to Node.js APIs (`fs`, `path`, `require`).

- **Return values**: The expression's return value is sent back to the agent.
  For complex data, use `JSON.stringify()` to serialize objects/arrays.

- **Async/Promises**: You can return a Promise — the tool will await it and
  return the resolved value. Use this for polling or waiting patterns.

- **Side effects persist**: DOM changes made via `evaluate_script` persist in
  the page. If you remove an element, it stays removed until the page reloads.

- **After DOM changes, retake snapshot**: If you modify the DOM (remove
  overlays, click buttons that change content), call `take_snapshot { pageId }` afterward
  to get fresh UIDs for the updated page state.

- **Error handling**: If your script throws, the error message is returned.
  Wrap risky operations in try/catch if you want graceful fallback:
  ```
  evaluate_script { pageId, function: "() => { try { return document.querySelector('.maybe').textContent } catch(e) { return null } }" }
  ```

## MCP 1.11 script and file sources

Default `format: "function"` takes a callable function. `format: "script"` instead
runs classic JavaScript, with no element `args`; it is passed through unchanged.
`sourcePath` loads an input file, while `filePath` saves output. These modes keep
upstream workspace checks and are not covered by inline-function stack hiding.
See [dependency-upgrades.md](dependency-upgrades.md) for workspace configuration.
