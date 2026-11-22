# Advanced DevTools Workflows

`my-agent-browser` exposes the full Chrome DevTools engine (`chrome-devtools-mcp@1.13.0`)
directly from the CLI — **Performance, Lighthouse, Console, Source-Mapped Logpoints,
CSS Inspection, Emulation, Screencast, and `take_heapsnapshot` are all enabled by default**.

Run `my-agent-browser tools` to see all enabled tools, or `my-agent-browser <tool> --help`
for live parameter schemas.

## 1. Source-Mapped Logpoints (`logpoints` / `set_logpoints`)

Log expressions to the console whenever a script or original source-mapped line runs —
without pausing execution, modifying source files, or calling `eval`:

```bash
# Set logpoints on page 1 (<url-or-suffix>:<line>[:<col>] <console-args-expr>)
my-agent-browser logpoints 1 "src/cart.ts:42 'total=', cart.total, JSON.stringify(cart.items)"

# Trigger the code path, then read output from console
my-agent-browser click 1 1_15
my-agent-browser console 1

# Clear all logpoints on page 1
my-agent-browser logpoints 1 --clear
```

Logpoints survive reloads and navigations until cleared or the tab is closed.

## 2. Console & CSS Inspection

```bash
# List console errors/warnings
my-agent-browser console 1 --types error --types warn
my-agent-browser get_console_message 1 3

# Inspect matched CSS rules for a snapshot element UID
my-agent-browser get_css_styles 1 1_4
```

## 3. Performance Tracing & Core Web Vitals

```bash
# Auto-reload trace with CWV insights
my-agent-browser performance_start_trace 1 --reload --auto-stop --file-path /tmp/trace.json.gz

# Or profile a manual interaction
my-agent-browser performance_start_trace 1 --no-reload --no-auto-stop
my-agent-browser click 1 1_42
my-agent-browser performance_stop_trace 1
my-agent-browser performance_analyze_insight 1 NAVIGATION_0 LCPBreakdown
```

## 4. Lighthouse Audits

```bash
# Full page-load audit
my-agent-browser lighthouse_audit 1 --mode navigation --device mobile

# Audit current post-login / SPA state without reloading
my-agent-browser lighthouse_audit 1 --mode snapshot --device desktop --output-dir-path /tmp/lh-out
```

## 5. Device, Network & Media Emulation

Each `emulate` call replaces previous emulation settings (except `--extra-http-headers`), so combine flags in one call:

```bash
my-agent-browser emulate 1 --network-conditions "Slow 3G" --cpu-throttling-rate 4 --color-scheme dark
# Reset to defaults
my-agent-browser emulate 1
```

## 6. Screencast Recording (Built-In, No ffmpeg Required)

```bash
my-agent-browser screencast_start 1 --file-path /tmp/demo.mp4
my-agent-browser click 1 1_10
my-agent-browser screencast_stop 1
```

## 7. Heap Snapshots & Opt-In Memory Debugging

`take_heapsnapshot` is available by default:

```bash
my-agent-browser take_heapsnapshot 1 /tmp/before.heapsnapshot
```

To analyze `.heapsnapshot` files directly from the CLI (even without a live browser),
add `"--memoryDebugging"` to `mcp.flags` in `config.json`, run `my-agent-browser restart`, then use:
`get_heapsnapshot_summary`, `get_heapsnapshot_dominators`, `get_heapsnapshot_retaining_paths`,
`compare_heapsnapshots`, `analyze_heapsnapshot_contexts`, `query_heapsnapshot_objects`, and `close_heapsnapshot`.

## 8. Virtual WebAuthn Passkeys (Opt-In)

Add `"--categoryWebauthn"` to `mcp.flags` and `my-agent-browser restart` to enable
`configure_webauthn` for testing passkey / security-key registration and sign-in flows.
