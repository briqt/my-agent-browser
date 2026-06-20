# Troubleshooting

## Common Issues

### "No pages found"

The browser has no open tabs. Create one:
```
new_page { url: "about:blank" }
```

### Click/fill does nothing or targets wrong element

The page changed since your last snapshot. UIDs are tied to the DOM state at
snapshot time. Solution: `take_snapshot` again and use the fresh UIDs.

### Element not visible in snapshot

Possible causes:
- Element is below the fold (scroll first)
- Element is inside an iframe (not captured by default)
- Element is dynamically loaded (use `wait_for` first)

Try `evaluate_script { function: "document.querySelector('selector').textContent" }` to verify the element exists.

### Timeout on `wait_for`

The expected text never appeared. Check current page state with `take_snapshot`
to see what's actually on the page. Common causes:
- Navigation failed silently
- Page requires JavaScript that didn't execute
- Text is in a different case or has extra whitespace

### Chrome not starting

Check:
1. Is Chrome/Chromium installed? (`which google-chrome`)
2. Is the CDP port already in use? (`curl http://127.0.0.1:19333/json/version`)
3. On Linux without display: set `"headless": true` in config
4. On WSL/containers: add `"--no-sandbox"` to `extraArgs`

### MCP server connection failed

The `start-mcp.js` wrapper couldn't launch chrome-devtools-mcp. Check:
1. Is `chrome-devtools-mcp` installed? (`chrome-devtools-mcp --version`)
2. If not: `npm install -g chrome-devtools-mcp@latest`
3. Is Node.js 20+ available? (`node --version`)

### Page loads but snapshot is empty or minimal

Some pages render content via JavaScript after initial load. Use:
```
wait_for { text: ["expected content"] }
```
before taking the snapshot.

### Anti-detection / bot detection

If sites detect automation, add anti-detection flags to config:
```json
{
  "browser": {
    "extraArgs": [
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars"
    ]
  }
}
```

### Large DOM pages cause memory overflow / browser crash

Pages with many DOM nodes (e.g., rich-text editors with 200+ paragraphs, long tables, chat histories) can crash the browser or hang the agent when you use `includeSnapshot: true` on interactions or `wait_for`.

**Root cause**: The snapshot serializes the entire accessibility tree. On a page with thousands of nodes, this produces a massive payload that exceeds memory limits.

**Symptoms**:
- Browser becomes unresponsive after `click { uid, includeSnapshot: true }`
- `wait_for` hangs indefinitely on a page that clearly has the text
- Agent reports "browser disconnected" or "target closed"
- Repeated timeouts after injecting content into an editor

**Solution — file-based snapshots**:

1. Always use `includeSnapshot: false` (or omit it) for `click`, `fill`, `hover` on heavy pages
2. When you need to read page state, save the snapshot to a file instead of returning it inline:
   ```
   take_snapshot { filePath: "/tmp/page-state.txt" }
   ```
3. Then read only the portion you need (dialogs and modals are typically at the end):
   ```bash
   tail -100 /tmp/page-state.txt
   ```
4. Close unrelated tabs before working with heavy pages — each tab holds its DOM in memory

**When does this typically happen?**
- Rich-text/WYSIWYG editors (ProseMirror, TipTap, CKEditor, Quill) after injecting long content
- Admin dashboards with large data tables
- Chat/messaging apps with long conversation history
- Any page where you've injected content via `evaluate_script` that creates many DOM nodes

**Prevention**: If you know the page will be heavy (e.g., you're about to inject a 2000-word article into an editor), switch to the file-based snapshot workflow proactively — don't wait for the crash.

### Using a proxy

Set in config (`~/.config/agent-skills/my-agent-browser/config.json`):
```json
{
  "browser": {
    "proxy": "http://127.0.0.1:3067"
  }
}
```

Restart the agent session for config changes to take effect.
