# Upstream Dependency & Architecture Compatibility

Verified **2026-11-22**: `my-agent-browser` **2.0.0** with bundled **`chrome-devtools-mcp@1.13.0`**,
Node **24.15.0**, npm **11.12.1**, Microsoft Edge on macOS.

## v2.0.0 Architecture Shift (Standalone CLI + Bundled Engine)

- **Zero MCP client setup**: Agents invoke the `my-agent-browser` CLI directly over shell commands. A lightweight local daemon (`src/daemon.js`) manages Chrome lifecycle, multi-agent `owner` tab locks, configurable `idleTimeout` (`"30m"` default or `"never"`), stealth script rewriting, and `BatchSession` (`batch`), while driving a private `chrome-devtools-mcp@1.13.0` child over stdio.
- **Automatic dependency management**: `package.json` pins `"chrome-devtools-mcp": "1.13.0"`. Installing or updating via `npm i -g github:briqt/my-agent-browser --install-links` automatically installs the exact tested engine inside `my-agent-browser`'s `node_modules/`.
- **Dynamic entrypoint resolution**: `resolveMcpPackage()` reads `chrome-devtools-mcp/package.json`'s `bin["chrome-devtools-mcp"]` (`./out/Default/gen/src/bin/chrome-devtools-mcp.js` in 1.13.0's GN/Ninja build, replacing 1.12.0's `./build/src/bin/...`), eliminating hardcoded internal build paths on all platforms including Windows.
- **Legacy v1.x MCP safety stub**: `skills/my-agent-browser/scripts/start-mcp.js` remains as a tiny zero-dependency JSON-RPC stub exposing only `my_agent_browser_mcp_deprecated`, preventing startup crashes in unmigrated v1 MCP clients while guiding removal.

## `chrome-devtools-mcp 1.13.0` Improvements Followed

1. **Same-URL navigation & reload reporting (`#3395`)**: `WaitForHelper` now tracks main-frame document loads via CDP `Page.frameNavigated`, populating `structuredContent.navigatedToUrl` even when the URL does not change (e.g. `location.reload()` or form POST back to the same URL). This closes a boundary-detection blind spot for `my-agent-browser batch`.
2. **Task serialization across cancellation (`#3079`)**: Cancelling an in-flight request keeps its per-page `TaskRunner` guard until the underlying browser handler settles, preventing subsequent commands from racing unfinished operations.
3. **33 default tools + new opt-in categories**:
   - Default set adds `set_logpoints` (`my-agent-browser logpoints <pageId> ...` / `--clear`).
   - Opt-in `--categoryNetworkMocks` adds `mock_network` and `remove_network_mock`.
   - Opt-in `--categoryWebauthn` adds `configure_webauthn`.
4. **CLI ergonomics fixed over bare upstream CLI**:
   - Restores `fill_form` (`fill-form`) and `wait_for` (`wait-for`), both omitted from upstream `chrome-devtools` `cli-options.js`.
   - Normalizes `<pageId>` position across all commands (including `eval` / `evaluate_script`), supports `--clear` empty array on `logpoints`, saves inline screenshots to files instead of dumping base64, and provides `eval --raw` for Unix pipelines.
5. **Upstream env isolation**: Daemon sets `CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS=1`, `CHROME_DEVTOOLS_MCP_NO_CONFIG_DISCOVERY=1`, `--no-usage-statistics`, and `--no-performance-crux` (unless explicitly overridden in `mcp.flags`).

## Upstream `1.14` Preview Notes (Tracked, Not Yet Released)

- Upstream `main` recently merged a server flag `--backgroundNewPages` (`#3539`) that **forcibly** opens all `new_page` tabs in the background even when `background: false` is passed, whereas `config.mcp.backgroundNewPages: true` in `my-agent-browser` is a soft default (respecting explicit `--foreground` / `background: false`). Both can coexist cleanly when `1.14.0` releases.
- Upstream `main` `#3431` adds `structuredContent.consoleErrors`; `BatchSession.boundary()` checks only explicit boundary keys (`reconnected`, `dialog`, `navigatedToUrl`, `openedPages`) and is unaffected.
