# Browser dependency compatibility

Verified 2026-11-05: wrapper **1.5.0** with **chrome-devtools-mcp 1.12.0**,
Node **24.15.0**, npm **11.12.1**, Microsoft Edge **156.0.4314.58** on macOS.
The upstream npm `latest` tag and latest GitHub release both resolve to 1.12.0.
Install the tested dependency with:

```bash
npm install -g chrome-devtools-mcp@1.12.0
node <skill-dir>/scripts/start-mcp.js --doctor --json
```

MCP requires Node 20.19+ on 20.x, 22.12+ on 22.x, or 23+. Node 24 LTS is recommended.
`version.json` supplies the wrapper version and tested MCP version. Doctor reports
the actual installed binary/version; the npx fallback is pinned to the tested version.
An existing PATH binary is not silently upgraded or replaced.

## Wrapper 1.5.0 batching

The tested MCP dependency remains 1.12.0. `run_actions` relies on its structured
interruption fields, so the wrapper enables `--experimentalStructuredContent=true`
when batching is enabled. Other installed MCP versions keep native tools only.
Existing config files require no migration; `mcp.batchActions: false` opts out.
Update the Skill and restart the MCP session; updating npm alone does not add this tool.

`batch-e2e.js` verifies stable forms, upfront rejection, DOM replacement, dialog
interruption and terminal navigation on isolated local pages. Unit/process tests
cover cancellation, late settlement, recovery and flushing partial results at exit.
Compound actions also passed in eager and direct modes; the copied installation
passed 58 tests (the repository-only feed check is skipped) and batch browser checks.
Batching reduces outer calls for known segments, not the number of actual browser
operations; no model token/latency benchmark is claimed.

## 1.12 compatibility and validation

- All **59** tests passed with `node --test skills/my-agent-browser/scripts/*.test.js`, covering request
  rewriting, transport recovery, documentation examples and update-check behavior.
- Installed MCP 1.12.0 in an isolated temporary npm prefix and ran `stealth-e2e.js`
  with that prefix first on PATH. No global MCP installation or personal browser
  profile was changed.
- Real-browser checks passed: lazy/eager managed modes, direct mode, numeric pageId
  rejection/acceptance, live native tool schemas (32 upstream tools, plus wrapper run_actions when enabled), background new pages,
  inline function stack hiding with a non-vacuous control, classic scripts and file sources.
- A controlled recovery trigger with real MCP child processes reinitialized the
  replacement and proved a completed page mutation was not replayed. This tests
  the recovery mechanism, not spontaneous occurrence of an upstream stale-state bug.
- `skills` **1.7.6** local-source copy installation preserved version metadata,
  scripts, references and templates. This checks packaging, not remote publication.
- These headless checks do not validate GUI focus, Windows/Linux behavior or every
  upstream feature. The user's already-running sessions were not restarted.

1.12 retains the wrapper's script/background seams. It also adds independent-call
and per-page concurrency, deferred focus emulation, failed-new-page cleanup, bounded
snapshot/body waits and upstream config watching. Cross-page concurrency is not a
compound-action API and does not synchronize separate MCP processes.

`--watchConfig` applies to an upstream `--config` file, not wrapper settings.
Browser launch/connection settings still need a restart. Hot-reloaded URL
restrictions do not detach already-attached targets.

`--slim` remains valid for `chrome-devtools-mcp`; the release's CLI restriction is
for `chrome-devtools start`. Slim's `navigate`/`evaluate`/`screenshot` tools omit
normal pageId routing and do not use this wrapper's `evaluate_script` or `new_page`
rewrites. Prefer the normal tool set for this skill's workflow.

Prior baseline: wrapper 1.3.0 / MCP 1.11.0 was tested on 2026-10-22. There was no
record of testing and rejecting 1.12; the new evidence supersedes that baseline.

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
shares the same request pipeline and is included in the headless checks above.
None of these tests is a GUI focus guarantee.

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

Primary sources: [1.12.0 release notes](https://github.com/ChromeDevTools/chrome-devtools-mcp/releases/tag/chrome-devtools-mcp-v1.12.0),
[1.11.0 release notes](https://github.com/ChromeDevTools/chrome-devtools-mcp/releases/tag/chrome-devtools-mcp-v1.11.0),
[tool documentation](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/chrome-devtools-mcp-v1.11.0/docs/tool-reference.md),
and the installed package's `--help` and `tools/script.js` schema.
