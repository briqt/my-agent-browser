# Changelog

## v1.1.0

### Added

- **`evaluate_script` stack-trace hiding** (`stealth.evaluateScript`, on by default).
  puppeteer tags every evaluated script with `//# sourceURL=pptr:...`, and that URL
  embeds the absolute path of the chrome-devtools-mcp install — on most machines that
  includes the OS username. Any page-side getter could read it back out of
  `new Error().stack`. `start-mcp.js` now rewrites the `function` argument so the
  script runs from a fresh timer stack and carries its own benign sourceURL.
  Configurable via `stealth.sourceUrl`; pass your own `//# sourceURL=` line to opt a
  single call out.
- `references/anti-detection.md` — flag-by-flag measurements on Chrome 148, plus a
  breakdown of what each MCP tool exposes to page code.
- `scripts/start-mcp.test.js` — unit tests (`node --test`). Includes a guard that the
  generated wrapper still matches puppeteer's `SOURCE_URL_REGEX`, so an upstream
  change that breaks the rewrite fails the suite instead of degrading silently.
- `scripts/stealth-e2e.js` — end-to-end check that a site-origin trap sees no `pptr:`
  frame, install path or home directory. Runs a control pass with the rewrite
  disabled so the test cannot pass vacuously, and covers both start modes.

### Changed

- **Recommended Chrome flags rewritten from measurements.** Removed from
  `config.example.json` and all docs:
  - `--disable-gpu` — makes `getContext('webgl')` return `null`, since software WebGL
    has required `--enable-unsafe-swiftshader` from Chrome 110 onward. No WebGL at all
    is a stronger bot signal than any renderer string.
  - `--disable-blink-features=AutomationControlled` — does not change
    `navigator.webdriver` in this setup, because only `--enable-automation` sets it and
    nothing here passes that. It does trigger Chrome's yellow warning bar, costing
    ~52px of viewport (1366x768 renders at 1366x629).
  - `--hide-scrollbars` — reports scrollbar width 0 where every real Chrome, headless
    included, reports 15.

  `config.example.json` now ships the vetted set, each flag measured to leave the
  browser indistinguishable from bare Chrome.
- WebGL guidance is now a ladder: nothing → `--ignore-gpu-blocklist` →
  `--enable-unsafe-swiftshader`, stopping at the first that returns a renderer string.
- Anti-detection advice across `SKILL.md`, `troubleshooting.md` and
  `scraping-patterns.md` now points at exit IP and WebGL renderer first, instead of
  recommending the AutomationControlled flag.

### Fixed

- Client→server lines are now proxied line-by-line for the whole session. Previously
  the lazy-start path switched to a raw `pipe()` after the first `tools/call`, and the
  direct/non-lazy modes never parsed stdin at all.
- Replaying buffered messages after Chrome starts no longer reorders them: the
  triggering `tools/call` could previously be replayed *after* messages that arrived
  later than it.

## v1.0.0

Initial release.
