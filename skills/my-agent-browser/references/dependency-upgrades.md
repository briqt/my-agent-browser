# Browser dependency compatibility

Verified 2026-10-20: wrapper 1.2.0 with **chrome-devtools-mcp 1.11.0**, the npm
stable `latest` release. Install the tested version with:

```bash
npm install -g chrome-devtools-mcp@1.11.0
node <skill-dir>/scripts/start-mcp.js --doctor --json
```

MCP requires Node 20.19+ on 20.x, 22.12+ on 22.x, or 23+. Node 24 LTS is recommended.
The doctor reports the installed MCP path/version and whether it matches the tested
version. The wrapper's npx fallback uses this same version rather than a moving tag.

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
