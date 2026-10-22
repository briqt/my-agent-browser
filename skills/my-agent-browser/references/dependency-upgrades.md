# Browser dependency compatibility

Verified 2026-10-22: wrapper **1.3.0** with **chrome-devtools-mcp 1.11.0** on
macOS and Node 24. The 30 unit/documentation/recovery tests and isolated headless
browser checks passed, including lazy/eager startup with background defaults on,
script rewriting enabled/disabled, classic scripts and local file sources.
These headless checks do not validate macOS GUI focus behavior.
Install the pinned dependency with:

```bash
npm install -g chrome-devtools-mcp@1.11.0
node <skill-dir>/scripts/start-mcp.js --doctor --json
```

MCP requires Node 20.19+ on 20.x, 22.12+ on 22.x, or 23+. Node 24 LTS is recommended.
The doctor reports the installed MCP path/version and whether it matches the tested
version. The wrapper's npx fallback uses this same version rather than a moving tag.

## Wrapper 1.3.0: background new pages

- `config.mcp.backgroundNewPages` is a wrapper boolean, default `false`, not an
  upstream CLI flag. Do not add it to `mcp.flags`.
- Omitted/`false` preserves upstream `new_page` behavior entirely. Only strict
  boolean `true` supplies `background: true` when the call omits `background`;
  explicit call values `true` and `false` are always respected.
- Lazy, eager and direct (`browserUrl`) modes share this behavior, independently
  of stealth settings. Restart the MCP session after config changes.
- This is not a focus guarantee for Chrome's first GUI launch, website
  `window.open` popups, or `select_page { pageId, bringToFront: true }`.
  Only `bringToFront: true` actively brings the tab to front; logical selection
  is not OS foreground focus. Route page tools directly with `pageId`.

Default and opt-in config examples are in [setup.md](setup.md). Direct mode
shares the same request pipeline; the real-browser checks above cover managed
lazy/eager startup, not a separate direct-mode GUI test.

## Changes followed in 1.11

- `evaluate_script` accepts either inline `function` or local `sourcePath`, plus
  `format: "function" | "script"`. The wrapper rewrites only inline function mode.
  Classic scripts retain their global-script semantics; file sources retain upstream
  path validation. Stack-trace hiding does **not** apply to those two passthrough modes.
- `sourcePath` is the input JavaScript file; `filePath` is the output destination.
  With function mode, source files must contain a callable function. Script mode
  does not support element `args` or ECMAScript modules.
- Filesystem access uses negotiated MCP roots, or the OS temp directory by default.
  To permit a project directory, configure `mcp.flags: ["--workspace=/absolute/project"]`
  or use a client that provides roots. Multiple workspaces are supported. Do not
  automatically broaden the workspace to the entire filesystem.
- `--fileNavigations=false` rejects file URL navigations; local HTML previews need
  to account for that setting independently of file-read/write permissions.
- `screencast_start` / `screencast_stop` use the built-in recorder by default; ffmpeg
  is only needed for the deprecated `--experimentalScreencast` implementation.
- `--categoryExtensions` can now be used with an existing browser/CDP connection.
- The upstream release also fixes long tool calls closing healthy browsers and
  fail-fast behavior after dead browser connections. Wrapper recovery still fails
  in-flight actions explicitly and never silently replays mutations.

## Upgrade checks

Check the upstream release notes and CLI help, then run the wrapper's tests and
`stealth-e2e.js` with the new MCP binary on PATH. The e2e uses separate temporary
profiles and exercises lazy/eager startup, inline functions, classic scripts and
local source files. Existing browser profiles/configs are not migrated automatically.

Primary sources: [1.11.0 release notes](https://github.com/ChromeDevTools/chrome-devtools-mcp/releases/tag/chrome-devtools-mcp-v1.11.0),
[tool documentation](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/chrome-devtools-mcp-v1.11.0/docs/tool-reference.md),
and the installed package's `--help` and `tools/script.js` schema.
