# Advanced Tools

This guide covers the advanced tool categories that require explicit flags in
`~/.config/agent-skills/my-agent-browser/config.json`. Enable them by adding the corresponding
`--category*` flag to `mcp.flags`. See [setup.md](setup.md) for configuration details.

## Performance Tools

**Required flag:** `--categoryPerformance`

### Available Tools

| Tool | Purpose |
|------|---------|
| `performance_start_trace` | Begin recording a performance trace |
| `performance_stop_trace` | Stop recording and return trace results |
| `performance_analyze_insight { id, type }` | Deep-dive into a specific insight from the trace |
| `take_memory_snapshot { filePath }` | Capture a V8 heap snapshot to disk |
| `close_heapsnapshot { filePath }` | Release a previously loaded heap snapshot from memory |
| `get_heapsnapshot_dominators { filePath }` | Get dominator tree nodes (find what retains the most memory) |
| `get_heapsnapshot_edges { filePath, nodeId }` | Get edges from a specific node in the heap graph |
| `get_retaining_paths { filePath, nodeId }` | Find retaining paths to a node (debug why it's not GC'd) |

### Workflow: Profile a Page Load

```
1. navigate_page { url: "about:blank" }
2. performance_start_trace
3. navigate_page { url: "https://example.com/dashboard" }
4. wait_for { text: ["Dashboard loaded"] }
5. performance_stop_trace
   → Returns: summary with metrics (FCP, LCP, CLS, TBT) and a list of insights
6. performance_analyze_insight { id: "lcp-element", type: "lcp" }
   → Returns: details about the LCP element, what delayed it, suggestions
```

### Workflow: Profile an Interaction

```
1. navigate_page { url: "https://app.example.com" }
2. take_snapshot → find the button uid
3. performance_start_trace
4. click { uid: "1_42" }
5. wait_for { text: ["Results"] }
6. performance_stop_trace
   → Shows how long the interaction took, JS execution time, layout shifts
```

### Memory Snapshots

Use `take_memory_snapshot` to capture heap state for memory leak investigation:

```
1. navigate_page { url: "https://app.example.com" }
2. take_memory_snapshot { filePath: "/tmp/before.heapsnapshot" }
3. click { uid: "1_10" }   — trigger the suspected leak
4. take_memory_snapshot { filePath: "/tmp/after.heapsnapshot" }
```

The `.heapsnapshot` files can be loaded in Chrome DevTools Memory panel for comparison.

### Memory Debugging (v1.2+)

Analyze heap snapshots programmatically without leaving the agent:

```
1. take_memory_snapshot { filePath: "/tmp/snapshot.heapsnapshot" }
2. get_heapsnapshot_dominators { filePath: "/tmp/snapshot.heapsnapshot" }
   → Returns: top nodes by retained size (find what's holding the most memory)
3. get_heapsnapshot_edges { filePath: "/tmp/snapshot.heapsnapshot", nodeId: "12345" }
   → Returns: outgoing references from a node
4. get_retaining_paths { filePath: "/tmp/snapshot.heapsnapshot", nodeId: "12345" }
   → Returns: paths from GC roots to this node (why it's not garbage collected)
5. close_heapsnapshot { filePath: "/tmp/snapshot.heapsnapshot" }
   → Releases memory used by the loaded snapshot
```

## Lighthouse

**Required flag:** `--categoryLighthouse`

### Available Tools

| Tool | Purpose |
|------|---------|
| `lighthouse_audit { mode, device }` | Run a full Lighthouse audit |

### Parameters

- `mode`: `"navigation"` (full page load audit) or `"snapshot"` (audit current state without reload)
- `device`: `"desktop"` or `"mobile"`

### Workflow: Full Page Audit

```
1. navigate_page { url: "https://example.com" }
2. lighthouse_audit { mode: "navigation", device: "mobile" }
   → Returns: scores for Performance, Accessibility, Best Practices, SEO
   → Plus specific diagnostics and opportunities
```

### Workflow: Audit Current State (No Reload)

Use snapshot mode when you've navigated to a specific state (e.g., after login,
after opening a modal) and don't want Lighthouse to reload the page:

```
1. navigate_page { url: "https://app.example.com/login" }
2. take_snapshot → fill login form → click submit
3. wait_for { text: ["Dashboard"] }
4. lighthouse_audit { mode: "snapshot", device: "desktop" }
   → Audits the post-login dashboard state
```

### Tips

- Navigation mode gives the most complete results (includes load metrics).
- Snapshot mode is useful for SPAs where the interesting state requires interaction.
- Mobile device emulation applies throttling automatically — results will differ from desktop.
- Run audits on a warmed-up page (visit once first) for more consistent results.

## Console

**Required flag:** `--categoryConsole`

### Available Tools

| Tool | Purpose |
|------|---------|
| `list_console_messages` | List all console messages (filterable) |
| `get_console_message { id }` | Get full message details with stack trace |

### Workflow: Find JavaScript Errors

```
1. navigate_page { url: "https://example.com" }
2. take_snapshot — interact with the page as needed
3. list_console_messages
   → Returns: list of messages with id, type (log/warn/error/info), and text preview
4. get_console_message { id: "msg_3" }
   → Returns: full message text, stack trace, source location
```

### Filtering

`list_console_messages` returns all message types. Look for:
- `error` — JavaScript exceptions, failed assertions
- `warning` — deprecation notices, potential issues
- `log` / `info` — application debug output

### Tips

- Console messages accumulate from page load. Navigate to a fresh page to reset.
- Errors from third-party scripts (ads, analytics) are common — check the source URL.
- Stack traces from `get_console_message` show the exact file and line number.

## Emulation

**Required flag:** `--categoryEmulation`

### Available Tools

| Tool | Purpose |
|------|---------|
| `emulate { ... }` | Set device emulation conditions |

### Parameters (all optional, combine as needed)

| Parameter | Example | Effect |
|-----------|---------|--------|
| `networkConditions` | `"slow-3g"`, `"fast-3g"`, `"offline"` | Throttle network speed |
| `cpuThrottlingRate` | `4` | Slow CPU by 4x (simulates low-end device) |
| `geolocation` | `{ latitude: 48.8566, longitude: 2.3522 }` | Spoof GPS location |
| `colorScheme` | `"dark"` or `"light"` | Force color scheme preference |
| `viewport` | `{ width: 375, height: 812 }` | Change viewport dimensions |
| `userAgent` | `"Mozilla/5.0 ... Mobile"` | Override user agent string |

### Workflow: Test on Slow 3G

```
1. emulate { networkConditions: "slow-3g", cpuThrottlingRate: 4 }
2. navigate_page { url: "https://example.com" }
3. take_snapshot — check if content loads acceptably
4. emulate { networkConditions: null, cpuThrottlingRate: 1 }  — reset
```

### Workflow: Test Dark Mode

```
1. emulate { colorScheme: "dark" }
2. navigate_page { url: "https://example.com" }
3. take_screenshot — visually verify dark mode rendering
4. emulate { colorScheme: "light" }  — reset
```

### Workflow: Test Mobile Viewport

```
1. emulate { viewport: { width: 375, height: 812 }, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15" }
2. navigate_page { url: "https://example.com" }
3. take_snapshot — check responsive layout
```

### Workflow: Test Geolocation-Dependent Features

```
1. emulate { geolocation: { latitude: 35.6762, longitude: 139.6503 } }
2. navigate_page { url: "https://maps.example.com" }
3. take_snapshot — verify location-based content shows Tokyo
```

### Tips

- Emulation settings persist until changed or the page is closed.
- Set parameters to `null` or omit them to reset to defaults.
- Combine multiple parameters in one call for realistic device simulation.
- Network throttling affects all subsequent requests, including XHR/fetch.
- CPU throttling makes JavaScript execution slower — useful for testing perceived performance.

## Combining Advanced Tools

These categories work together for comprehensive analysis:

### Full Performance Audit Workflow

```
1. emulate { networkConditions: "fast-3g", cpuThrottlingRate: 2 }
2. performance_start_trace
3. navigate_page { url: "https://example.com" }
4. wait_for { text: ["loaded"] }
5. performance_stop_trace → check metrics under throttled conditions
6. list_console_messages → check for errors during load
7. lighthouse_audit { mode: "navigation", device: "mobile" } → full audit
8. emulate { networkConditions: null, cpuThrottlingRate: 1 } → reset
```

### Debug a Slow Page

```
1. performance_start_trace
2. navigate_page { url: "https://slow-page.example.com" }
3. performance_stop_trace → identify bottlenecks
4. list_network_requests → find slow/large resources (requires --categoryNetwork)
5. list_console_messages → check for JS errors causing delays
```
