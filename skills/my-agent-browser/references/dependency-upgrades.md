# Upstream Dependency & Architecture Compatibility

Verified **2026-11-22**: `my-agent-browser` **2.1.0** with bundled **`chrome-devtools-mcp@1.13.0`**, Node **24.15.0**, npm **11.12.1**, macOS.

## Architecture Overview

- **Standalone CLI + Local Daemon**: Agents call `my-agent-browser` over shell commands. A lightweight local daemon (`src/daemon.js`) launches Chrome on demand, enforces multi-agent `owner` tab locks, handles `idleTimeout` shutdown, rewrites inline `eval` stack traces, forces background new tabs, and drives a private `chrome-devtools-mcp@1.13.0` child over stdio.
- **Bundled Engine**: `package.json` pins `"chrome-devtools-mcp": "1.13.0"`. Installing via `npm i -g github:briqt/my-agent-browser --install-links` bundles the tested version automatically; `resolveMcpPackage()` resolves its `package.json` `bin` entry dynamically across macOS, Linux, and Windows.
- **All 50 Practical Upstream Tools Enabled by Default**: Because CLI tools add zero context overhead, the daemon enables `--memory-debugging` (13 heap analysis tools), `--category-network-mocks` (`mock_network`, `remove_network_mock`), `--category-webauthn` (`configure_webauthn`), and `--experimental-vision` (`click_at`) alongside the 33 default tools — 50 tools ready with zero config.
- **Upstream Alignment**:
  - Uses `--workspace=/` on POSIX (replacing 1.13.0's deprecated `--allow-unrestricted-paths`) and retains `--allow-unrestricted-paths` on Windows for multi-drive access.
  - Automatically passes `--wsEndpoint=` when `browser.browserUrl` uses `ws://` or `wss://`.
  - Restores `fill-form` and `wait-for` (omitted from upstream `chrome-devtools` `cli-options.js`), normalizes `<pageId>` positioning, supports `--raw` on `open`/`eval`/`shot`, provides offline `<tool> --help` from the bundled tool catalog, and saves screenshots to disk instead of dumping base64.
  - Isolates upstream noise with `CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS=1`, `CHROME_DEVTOOLS_MCP_NO_CONFIG_DISCOVERY=1`, `--no-usage-statistics`, and `--no-performance-crux`.
- **Intentional Upstream Exclusions**:
  - `--categoryExtensions` (requires `--enable-unsafe-extension-debugging` and alters `list_pages`/`evaluate_script` schemas; also disabled by upstream CLI in `browserUrl` mode).
  - `--categoryPwa` (incompatible with `--browserUrl` / `--wsEndpoint` upstream).
  - Hidden/experimental Chrome 150+ flags (`--categoryExperimentalWebmcp`, `--categoryExperimentalThirdParty`, `--devtoolsComments`, `--slim`).
