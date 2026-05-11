# JavaScript Execution with evaluate_script

`evaluate_script` runs JavaScript in the page context (the browser's runtime),
not in Node.js. It has access to `document`, `window`, and all page globals.

## Basic Usage

The `function` parameter is a JavaScript expression or IIFE that returns a value.

### Get page title

```
evaluate_script { function: "document.title" }
```

### Get current URL

```
evaluate_script { function: "window.location.href" }
```

### Get element text content

```
evaluate_script { function: "document.querySelector('h1').textContent" }
```

### Get an attribute value

```
evaluate_script { function: "document.querySelector('meta[name=description]').content" }
```

## Scrolling

### Scroll to bottom of page

```
evaluate_script { function: "window.scrollTo(0, document.body.scrollHeight)" }
```

### Scroll by a specific amount (pixels)

```
evaluate_script { function: "window.scrollBy(0, 500)" }
```

### Scroll element into view

```
evaluate_script { function: "document.querySelector('#target').scrollIntoView({ behavior: 'smooth' })" }
```

### Get current scroll position

```
evaluate_script { function: "JSON.stringify({ x: window.scrollX, y: window.scrollY })" }
```

## Data Extraction

### Extract table data as JSON

```
evaluate_script { function: "JSON.stringify([...document.querySelectorAll('table tr')].map(row => [...row.querySelectorAll('td, th')].map(cell => cell.textContent.trim())))" }
```

### Get all links on the page

```
evaluate_script { function: "JSON.stringify([...document.querySelectorAll('a[href]')].map(a => ({ text: a.textContent.trim(), href: a.href })))" }
```

### Get form field values

```
evaluate_script { function: "JSON.stringify(Object.fromEntries([...document.querySelectorAll('input, select, textarea')].map(el => [el.name || el.id, el.value])))" }
```

### Count elements matching a selector

```
evaluate_script { function: "document.querySelectorAll('.item').length" }
```

### Extract structured data (e.g., product cards)

```
evaluate_script { function: "JSON.stringify([...document.querySelectorAll('.product-card')].map(card => ({ title: card.querySelector('.title')?.textContent?.trim(), price: card.querySelector('.price')?.textContent?.trim(), url: card.querySelector('a')?.href })))" }
```

## DOM Manipulation

### Trigger a click event programmatically

```
evaluate_script { function: "document.querySelector('button.load-more').click()" }
```

### Set an attribute

```
evaluate_script { function: "document.querySelector('input#email').value = 'test@example.com'" }
```

### Remove an element (e.g., dismiss a modal overlay)

```
evaluate_script { function: "document.querySelector('.modal-overlay')?.remove()" }
```

### Dispatch a custom event

```
evaluate_script { function: "document.querySelector('#app').dispatchEvent(new Event('change', { bubbles: true }))" }
```

## Waiting for Conditions

### Wait for an element to appear (polling)

```
evaluate_script { function: "new Promise(resolve => { const check = () => { const el = document.querySelector('.results'); if (el) resolve(el.textContent); else setTimeout(check, 200); }; check(); })" }
```

### Wait using MutationObserver (more efficient)

```
evaluate_script { function: "new Promise(resolve => { const target = document.querySelector('#container'); if (target.querySelector('.loaded')) { resolve('ready'); return; } const obs = new MutationObserver(() => { if (target.querySelector('.loaded')) { obs.disconnect(); resolve('ready'); } }); obs.observe(target, { childList: true, subtree: true }); })" }
```

### Wait for network-loaded content with timeout

```
evaluate_script { function: "new Promise((resolve, reject) => { const timeout = setTimeout(() => reject('timeout'), 10000); const check = () => { const el = document.querySelector('[data-loaded]'); if (el) { clearTimeout(timeout); resolve(el.textContent); } else { setTimeout(check, 300); } }; check(); })" }
```

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
  overlays, click buttons that change content), call `take_snapshot` afterward
  to get fresh UIDs for the updated page state.

- **Error handling**: If your script throws, the error message is returned.
  Wrap risky operations in try/catch if you want graceful fallback:
  ```
  evaluate_script { function: "try { return document.querySelector('.maybe').textContent } catch(e) { return null }" }
  ```
