# Anti-Detection

All numbers below were measured on Chrome 148 with one flag changed at a time,
each run in its own temporary profile. Reproduce end-to-end stack and browser
checks with `npm run test:e2e`.

## What actually gives you away

In priority order. Chrome flags are near the bottom — a cleanly launched Chrome
already passes almost every classic automation check (`navigator.webdriver` is
`false` because `my-agent-browser` launches Chrome directly without Puppeteer's
`--enable-automation`).

1. **Exit IP and request pacing.** No browser flag fixes a datacenter IP hitting a
   site 40 times a minute. Use `browser.proxy` and pace requests naturally.
2. **`eval` (`evaluate_script`) stack traces.** Handled automatically — see below.
3. **WebGL renderer string.** The one thing a stock detector still flags on GPU-less hosts.
4. **Headless mode.** `--headless=new` puts `HeadlessChrome` in the UA and reports
   default `screen` metrics differently from headed mode. Use `"headless": false`
   (or `my-agent-browser restart --headed`) when a site screens aggressively.

## WebGL: the flag that matters

On bot.sannysoft.com, a config carrying `--disable-gpu --use-angle=swiftshader
--enable-unsafe-swiftshader` fails only one of 58 checks:

```
WebGL Renderer = ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)
```

SwiftShader is Chrome's bundled software renderer. Almost no real user machine
reports it, so it reads as "headless Chrome".

Worse is having no WebGL at all. Since Chrome 110, software WebGL requires an
explicit `--enable-unsafe-swiftshader`, so `--disable-gpu` on its own makes
`getContext('webgl')` return `null` — a stronger bot signal than any renderer string.

**Try these in order, stopping at the first that gives you a renderer string:**

1. **Nothing.** If the machine has a working GPU, Chrome reports it and you are done.
2. **`--ignore-gpu-blocklist`.** Use when the host has a GPU or Mesa driver that
   Chrome blocklisted — common in WSL2, VMs and containers. Yields a normal Mesa
   string (`llvmpipe`), which is ordinary on Linux desktops.
3. **`--enable-unsafe-swiftshader`.** Last resort for hosts with no GPU stack at all.

Check your current renderer with:

```bash
my-agent-browser eval 1 "() => { const gl = document.createElement('canvas').getContext('webgl'); if (!gl) return 'NO WEBGL'; const d = gl.getExtension('WEBGL_debug_renderer_info'); return gl.getParameter(d.UNMASKED_RENDERER_WEBGL); }" --raw
```

## Flags that cost you more than they give

| Flag | Measured effect |
|---|---|
| `--disable-blink-features=AutomationControlled` | **No effect on `navigator.webdriver`** in `my-agent-browser`, because only `--enable-automation` sets it and our launcher never passes that flag (unlike bare `puppeteer.launch`). What the flag does do is trigger Chrome's yellow "unsupported command-line flag" bar, costing ~52px of viewport height. |
| `--disable-gpu` | Kills WebGL entirely unless paired with `--enable-unsafe-swiftshader`. |
| `--hide-scrollbars` | Makes `offsetWidth - clientWidth` report `0` where every real desktop Chrome (headless included) reports `15`. |

## Flags that are safe

Measured identical to bare Chrome across `navigator.*`, WebGL, canvas, audio,
permissions and scrollbars — shipped by default in `config.json`:

```json
{
  "browser": {
    "extraArgs": [
      "--disable-dev-shm-usage",
      "--disable-background-networking",
      "--disable-sync",
      "--disable-translate",
      "--metrics-recording-only",
      "--mute-audio",
      "--disable-hang-monitor",
      "--disable-prompt-on-repost",
      "--disable-client-side-phishing-detection",
      "--disable-component-update",
      "--disable-domain-reliability",
      "--disable-features=TranslateUI"
    ]
  }
}
```

## How each command exposes you

| Command | Exposure |
|---|---|
| `snap` (`take_snapshot`) | None. Reads the accessibility tree over CDP without running page JS. |
| `click` / `fill` / `fill-form` / `hover` / `press` | None. CDP Input events go through Chrome's real input pipeline (`isTrusted: true`, clean page stack). |
| `eval` (`evaluate_script`) | Rewritten automatically in inline function mode — see below. |
| `--init-script` on `goto` | None. Reports as `<anonymous>`. |

## `eval` (`evaluate_script`) stack hiding

`puppeteer-core` tags every evaluated script with `//# sourceURL=pptr:...`, embedding
the install path of `chrome-devtools-mcp` (which normally contains your OS username).
Any page-side getter reading `new Error().stack` would otherwise see:

```
at pptr:evaluate;performEvaluation%20(file%3A%2F%2F%2FUsers%2FYOURNAME%2F...):3:41
```

With `stealth.evaluateScript: true` (default), the daemon wraps inline functions to run
from a fresh `setTimeout` stack and appends `//# sourceURL=eval.js` (matching Puppeteer's
documented `SOURCE_URL_REGEX` opt-out). Page traps see only:

```
at eval.js:1:66
```

- Set `"stealth": { "evaluateScript": false }` while debugging script line numbers, then `my-agent-browser restart`.
- Custom `//# sourceURL=` inside a function opts that single call out.
- Classic scripts (`--format script`) and file sources (`--source-path`) pass straight through to upstream without rewriting.
