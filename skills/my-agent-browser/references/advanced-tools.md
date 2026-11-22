# Advanced DevTools Workflows

All **50 Chrome DevTools tools** from `chrome-devtools-mcp@1.13.0` are enabled out of the box — zero configuration required. Run `my-agent-browser tools` to list them by category, or `my-agent-browser <tool> --help` offline for exact parameter schemas.

## 1. Source-Mapped Logpoints (`logpoints` / `set_logpoints`)

Log expressions to the console whenever a script or source-mapped line runs without pausing execution or modifying source files:

```bash
my-agent-browser logpoints 1 "src/cart.ts:42 'total=', cart.total, JSON.stringify(cart.items)"
my-agent-browser click 1 1_15
my-agent-browser console 1
my-agent-browser logpoints 1 --clear
```

Logpoints survive reloads and navigations until cleared or the tab is closed.

## 2. Console & CSS Inspection

```bash
my-agent-browser console 1 --types error --types warn
my-agent-browser get_console_message 1 3
my-agent-browser get_css_styles 1 1_4
```

## 3. Coordinate Clicking (`click-at` / `click_at`)

Useful for `<canvas>`, maps, PDFs, or custom widgets missing accessibility nodes:

```bash
IMG=$(my-agent-browser shot 1 --raw)
my-agent-browser click-at 1 640 360
```

## 4. Performance Tracing & Core Web Vitals

```bash
my-agent-browser performance_start_trace 1 --reload --auto-stop --file-path /tmp/trace.json.gz

# Or profile a manual interaction
my-agent-browser performance_start_trace 1 --no-reload --no-auto-stop
my-agent-browser click 1 1_42
my-agent-browser performance_stop_trace 1
my-agent-browser performance_analyze_insight 1 NAVIGATION_0 LCPBreakdown
```

## 5. Lighthouse Audits

```bash
my-agent-browser lighthouse_audit 1 --mode navigation --device mobile
my-agent-browser lighthouse_audit 1 --mode snapshot --device desktop --output-dir-path /tmp/lh-out
```

## 6. Device, Network & Media Emulation

Each `emulate` call replaces previous emulation settings (except `--extra-http-headers`), so combine flags in one call:

```bash
my-agent-browser emulate 1 --network-conditions "Slow 3G" --cpu-throttling-rate 4 --color-scheme dark
my-agent-browser emulate 1   # reset to defaults
```

## 7. Screencast Recording (Built-In, No ffmpeg Required)

```bash
my-agent-browser screencast_start 1 --file-path /tmp/demo.mp4
my-agent-browser click 1 1_10
my-agent-browser screencast_stop 1
```

## 8. Heap Snapshots & Offline Memory Analysis

Capture a heap snapshot from a live tab and analyze `.heapsnapshot` files directly (the 13 analysis tools work without launching Chrome):

```bash
my-agent-browser take_heapsnapshot 1 /tmp/before.heapsnapshot
my-agent-browser get_heapsnapshot_summary /tmp/before.heapsnapshot
my-agent-browser compare_heapsnapshots /tmp/before.heapsnapshot /tmp/after.heapsnapshot
my-agent-browser get_heapsnapshot_dominators /tmp/after.heapsnapshot 42
my-agent-browser close_heapsnapshot /tmp/before.heapsnapshot
```

## 9. Virtual WebAuthn Passkeys (`configure_webauthn`)

Test passkey / security-key registration and sign-in flows without hardware:

```bash
my-agent-browser configure_webauthn 1 true --protocol ctap2 --transport internal
my-agent-browser configure_webauthn 1 false   # remove authenticators
```
