# Anti-Detection

All numbers below were measured on Chrome 148 with one flag changed at a time,
each run in its own temporary profile. Reproduce with
`node scripts/stealth-e2e.js` and the probe described at the end.

## What actually gives you away

In priority order. Chrome flags are near the bottom — a default Chrome already
passes almost every classic automation check.

1. **Exit IP and request pacing.** No browser flag fixes a datacenter IP hitting a
   site 40 times a minute. Use `browser.proxy` and let the agent pace itself.
2. **`evaluate_script` stack traces.** Handled automatically now — see below.
3. **WebGL renderer string.** The one thing a stock detector still flags.
4. **Headless mode.** `--headless=new` puts `HeadlessChrome` in the UA and reports
   `screen` as 800x600 while the window is whatever you asked for. Not hideable by
   flags. Use `headless: false` when a site is actively screening.

## WebGL: the flag that matters

On bot.sannysoft.com, a config carrying `--disable-gpu --use-angle=swiftshader
--enable-unsafe-swiftshader` fails exactly one of 58 checks:

```
WebGL Renderer = ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)
```

SwiftShader is Chrome's bundled software renderer. Almost no real user machine
reports it, so it reads as "headless Chrome".

Worse is having no WebGL at all. Since Chrome 110, software WebGL requires an
explicit `--enable-unsafe-swiftshader`, so `--disable-gpu` on its own makes
`getContext('webgl')` return `null` — and a browser with no WebGL is more
suspicious than one with a software renderer.

**Try these in order, stopping at the first that gives you a renderer string:**

1. Nothing. If the machine has a working GPU, Chrome reports it and you are done.
2. `--ignore-gpu-blocklist`. Use when the host has a GPU or a Mesa driver that
   Chrome has blocklisted — common in WSL2, VMs and containers. Yields a normal
   Mesa string, e.g. `ANGLE (Mesa, llvmpipe (LLVM 20.1.2 256 bits), OpenGL 4.5)`.
   llvmpipe is ordinary on driver-less Linux desktops; SwiftShader is not.
3. `--enable-unsafe-swiftshader`. Last resort for hosts with no GPU stack at all.
   You get WebGL, but the renderer string is an automation tell.

Only add `--disable-gpu` if you are actually hitting GPU crashes, and pair it with
`--enable-unsafe-swiftshader` so WebGL survives.

## Flags that cost you more than they give

| Flag | Measured effect |
|------|-----------------|
| `--disable-blink-features=AutomationControlled` | **No effect on `navigator.webdriver`** in this skill. That property is only set by `--enable-automation`, which nothing here passes — `start-mcp.js` does not, and chrome-devtools-mcp connects to an already-running Chrome rather than launching it. What the flag does do is trigger Chrome's yellow "unsupported command-line flag" bar, which costs ~52px of viewport (1366x681 → 1366x629). Only useful if you point `browserUrl` at a Chrome that puppeteer/playwright started; add `--test-type` alongside it to suppress the bar. |
| `--disable-gpu` | Kills WebGL entirely unless paired with `--enable-unsafe-swiftshader`. See above. |
| `--hide-scrollbars` | Makes `offsetWidth - clientWidth` report 0 where every real desktop Chrome reports 15 — including headless Chrome, so this flag stands out more than headless does. Only worth it for screenshots without scrollbars. |

## Flags that are safe

Measured identical to bare Chrome on every fingerprint surface probed
(`navigator.*`, WebGL, canvas hash, audio fingerprint, permissions, scrollbars):

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

This is what `config.example.json` ships. `--mute-audio` was specifically checked
against an OfflineAudioContext fingerprint and does not change it.

## How each tool exposes you

Verified against a page whose own inline script recorded the stack of everything
that touched it:

| Tool | Exposure |
|------|----------|
| `take_snapshot` | None. Reads the accessibility tree over CDP without running page JS. |
| `click` / `fill` / `hover` / `press_key` | None. CDP Input events go through Chrome's real input pipeline: `isTrusted: true`, plausible `screenX/screenY`, `pointerType: "mouse"`, and the page sees only its own frames in the stack. |
| `evaluate_script` | Was the one real leak. Now rewritten — see below. |
| `initScript` on `navigate_page` / `new_page` | None. Reports as `<anonymous>`. |

The classic `Runtime.enable` detection — hanging a getter on `Error.prototype.stack`
and calling `console.log` — does **not** fire against chrome-devtools-mcp on
Chrome 148, even though console capture is active.

## evaluate_script stack hiding

puppeteer tags every script it evaluates with `//# sourceURL=pptr:...`, and that URL
embeds the absolute path of the chrome-devtools-mcp install — which usually contains
the OS username. A site only needs a getter on any property your script reads:

```js
Object.defineProperty(window, 'x', { get() { return new Error().stack; } });
```

Before:

```
at get (https://site.example/app.js:18:62)
at pptr:evaluateHandle;performEvaluation%20(file%3A%2F%2F%2Fhome%2FYOURNAME%2F...):1:22
at pptr:evaluate;performEvaluation%20(file%3A%2F%2F%2Fhome%2FYOURNAME%2F...):3:41
```

After (default since v1.1.0):

```
at get (https://site.example/app.js:18:62)
at eval.js:1:66
```

`start-mcp.js` rewrites the `function` argument of every `evaluate_script` call to
run from a fresh `setTimeout` stack and to carry its own `//# sourceURL`. puppeteer
documents that it skips its own tag when one is already present, so this uses a
supported path rather than patching anything.

Configure with:

```json
{
  "stealth": {
    "evaluateScript": true,
    "sourceUrl": "eval.js"
  }
}
```

- `evaluateScript` — set `false` to disable the rewrite entirely.
- `sourceUrl` — the name the script shows up as in stack traces. Must be a single
  token with no whitespace. Point it at a plausible same-origin path when you want
  it to blend in with the site's own bundles.
- Passing your own `//# sourceURL=` line in the function text opts that one call
  out of the rewrite.

Known trade-offs:

- Your script runs one task later than it used to. Transient user activation was
  measured to survive this (`navigator.userActivation.isActive` stays `true`), so
  `window.open` and clipboard access still work.
- Exception stacks point at the configured `sourceUrl`, so debugging a failing
  script is slightly less direct. Set `evaluateScript: false` while debugging.
- It relies on puppeteer's `SOURCE_URL_REGEX` escape hatch. `start-mcp.test.js`
  asserts the generated wrapper still matches that regex, so a breaking upstream
  change fails the test suite rather than silently degrading.

## Other measures

- Reuse a real `userDataDir` with cookies and history rather than a fresh profile.
- Prefer `headless: false` for sites that screen aggressively.
- Route through a residential proxy via `browser.proxy`.
- Prefer `take_snapshot` + `click`/`fill` over `evaluate_script` for interaction.
  They are invisible to page code; scripting is not, even with the rewrite.

## Reproducing the measurements

`scripts/stealth-e2e.js` boots the real wrapper against a throwaway config and
profile, drives it over the MCP protocol, and asserts a site-origin trap sees no
`pptr:` frame, no install path and no home directory. It runs a control pass with
the rewrite disabled first, so a test that can no longer detect the leak fails
loudly instead of passing vacuously.

```bash
node scripts/stealth-e2e.js          # end-to-end, needs Chrome
node --test scripts/start-mcp.test.js  # pure unit tests
```
