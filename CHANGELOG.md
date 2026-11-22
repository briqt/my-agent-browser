# Changelog

## v2.1.0 — 2026-11-22

### CLI-First Simplification, Full Upstream Tool Access & Workflow Polish

- **Remove legacy MCP-era config fields**: Dropped the entire `mcp` config section (`features`, `flags`, `backgroundNewPages`, `batchActions`) and `browser.lazyStart` from `config.json` and schema. Existing user config files containing old keys continue to load cleanly without error.
- **Always open new tabs in the background**: Removed `mcp.backgroundNewPages` and `open --background` / `--foreground`; all `new_page` calls now unconditionally open in the background so automation never steals OS focus.
- **Remove MCP-era `batch` / `run_actions` interceptor**: Deleted `src/batch-session.js` and `batch` subcommand. In CLI mode, agents naturally compose multi-step workflows with `fill-form`, `open --raw`, and shell `&&` fail-fast chains without blocking concurrent tabs or maintaining a wrapper state machine.
- **Enable all 50 practical upstream `chrome-devtools-mcp@1.13.0` tools out of the box**: Zero-config default activation of `--memory-debugging` (13 offline V8 heap analysis tools), `--category-network-mocks` (`mock_network`, `remove_network_mock`), `--category-webauthn` (`configure_webauthn`), and `--experimental-vision` (`click_at` / `click-at`).
- **Align upstream capabilities & protocols**:
  - Use `--workspace=/` on POSIX (replacing deprecated `--allow-unrestricted-paths`; Windows retains `--allow-unrestricted-paths` for multi-drive access).
  - Auto-detect `ws://` / `wss://` in `browser.browserUrl` and forward `--wsEndpoint=`.
  - Add `--handle-before-unload` and `--init-script` to `reload`, `back`, and `forward`; treat `performance_analyze_insight` as read-only for owner lock checks.
- **Workflow & CLI ergonomics improvements**:
  - `open` now returns top-level `pageId` in `--json`, supports `--raw` to print the bare numeric ID for shell capture (`ID=$(my-agent-browser open ... --raw)`), and prints a concise single-line summary by default.
  - `shot --raw` prints only the saved screenshot file path.
  - `config show` prints the effective configuration with defaults merged.
  - `tools` groups all 50 tools by DevTools category; `<command> --help` works completely offline for all built-in commands and all 50 upstream tools without starting the daemon.
  - `close-page` now clears the tab's `owner` lock even when Chrome refuses to close its last remaining tab, preventing stale locks from blocking `stop` / `restart`.
  - Fixed a CLI boolean parsing bug where inline `--<flag>=false` (e.g. `--wait-for-stable-dom=false`) was coerced to `true`, and added `--kebab-case` to `snake_case` parameter mapping in dynamic tool calls.

## v2.0.0 — 2026-11-22

### Breaking Architecture Upgrade: Standalone CLI + Managed Daemon (No MCP Required)

- **Replace MCP server setup with the `my-agent-browser` CLI**: Eliminates upfront MCP tool-schema context bloat and per-agent configuration files, decoupling browser lifetime from individual agent conversations.
- **Bundle and pin `chrome-devtools-mcp@1.13.0`**: Installing via `npm i -g github:briqt/my-agent-browser --install-links` automatically installs the tested engine in-package — no separate global `chrome-devtools-mcp` installation required. Dynamic `package.json` `bin` resolution supports 1.13.0's GN/Ninja layout across macOS, Linux and Windows.
- **Add configurable browser idle shutdown (`browser.idleTimeout`)**: Defaults to `"30m"` of inactivity (`ms`/`s`/`m`/`h` units supported) and supports `"never"` / `0` to keep Chrome open indefinitely. Never closes external `browser.browserUrl` browsers.
- **Add multi-agent `owner` model (`--owner` / `MY_AGENT_BROWSER_OWNER`)**:
  - Lock tabs on `open` or via `claim` / `release`; inspect active owners, per-tab idle durations and `canStopSafely` via `pages` and `status`.
  - Block unauthorized cross-agent mutations on owned tabs and refuse `stop` / `restart` while other owners hold open tabs unless `--force` is passed.
- **Ergonomic CLI + 100% DevTools native ceiling**:
  - Concise commands (`open`, `pages`, `goto`, `reload`, `snap`, `shot`, `click`, `fill`, `fill-form`, `wait-for`, `eval --raw`, `batch`, `console`, `network`, `logpoints`) plus lossless schema-driven invocation of every upstream tool (`lighthouse_audit`, `mock_network`, `configure_webauthn`, heap analysis, …).
  - Save inline screenshots automatically to disk instead of dumping base64 to stdout; add `--raw` on `eval` for clean shell/jq pipelines.
  - Adopt 1.13.0 same-URL navigation boundary detection (`#3395`) and cancellation queue serialization (`#3079`) in `batch`.
- **Smooth v1.x → v2.0 migration**: Keep `skills/my-agent-browser/scripts/start-mcp.js` as a lightweight zero-dependency deprecation stub (`my_agent_browser_mcp_deprecated`) so existing MCP configurations do not crash on startup and instruct agents/users to remove the legacy MCP entry.

## v1.5.0 — 2026-11-05

- Add `run_actions`: up to 10 sequential known actions on one page, with a terminal
  click/key and optional final/file snapshot. Default enabled on tested MCP 1.12.0;
  disable with `mcp.batchActions: false` and restart.
- Prevalidate all supported parameter shapes; stop on errors/dialogs/navigation/new
  pages, preserve partial results, never replay or roll back actions.
- Keep same-session tools excluded while timed-out/cancelled actions settle. Flush
  partial reports before transport exit; final snapshot failures retain action status.
- Enable upstream structured results for boundary detection; fail closed if missing.
  Discover live capabilities per batch and retain upstream workspace restrictions.
- Update Skill guidance for stable batches, accurate UID lifetime and partial-result
  recovery; add unit/process tests and isolated browser scenarios.

## v1.4.0 — 2026-11-05

- Pin the tested/fallback MCP dependency to 1.12.0; document upstream concurrency,
  focus, config reload and slim-mode boundaries.
- Add optional asynchronous update checks, stable-version comparison, bounded feed
  fetching, cache/backoff, independent version/notice cooldowns and process locking.
  Notifications use stderr; checks never install updates or fail browser operations.
- Add `--check-update`, `--no-update-check`, `--init-config` and `--help`.
  `version.json` is the wrapper version and tested-dependency source.
- Require explicit `--dev-config` for skill-local configuration; validate configured
  field types without echoing secret values. Existing user config is preserved.
- Clarify numeric pageId (issue #2); add upstream schema, direct-mode and real-child
  recovery integration checks alongside isolated update-check tests.
- Record issue #3 analysis and multi-action browser research without adding a batch
  execution API in this release.

## v1.3.0

### Added

- Optional `mcp.backgroundNewPages` wrapper policy, disabled by default. When set
  to `true`, `new_page` calls without a `background` argument get `background: true`.
  Explicit arguments always win; missing/false config preserves upstream behavior.
- Apply the policy independently of script rewriting across lazy, eager and direct
  connection modes, including requests queued during MCP recovery.

## v1.2.0

- Upgrade and pin chrome-devtools-mcp 1.11.0; report actual/tested MCP versions in doctor and document the new file/workspace and recording behavior.
- Keep the client transport alive while retiring a stale MCP child, replay the initialize handshake, and wait for readiness before new calls.

## v1.1.1

- `scripts/migrate-config.js` — migrates a v1.0.x config to the v1.1 recommendations.

## v1.1.0

- `evaluate_script` stack-trace hiding (`stealth.evaluateScript`, on by default).
- Recommended Chrome flags rewritten from single-factor measurements.

## v1.0.0

Initial release.
