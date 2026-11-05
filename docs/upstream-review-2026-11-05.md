# Upstream and issue review — 2026-11-05

## Sources and scope

Read npm registry metadata, the actual installed npm package/help and GitHub release
notes for chrome-devtools-mcp **1.12.0** (latest stable in both npm and GitHub).
Published 2026-10-22; Node requirement remains `^20.19.0 || ^22.12.0 || >=23`.
The npm artifact bundles its runtime dependencies, so this wrapper's direct external
runtime dependency remains that single pinned package. No independent transitive
version overrides were introduced.

- [Upstream release](https://github.com/ChromeDevTools/chrome-devtools-mcp/releases/tag/chrome-devtools-mcp-v1.12.0)
- [1.12 tool definitions](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/chrome-devtools-mcp-v1.12.0/src/tools/ToolDefinition.ts)
- [Project issues](https://github.com/briqt/my-agent-browser/issues)
- [Project pull requests](https://github.com/briqt/my-agent-browser/pulls)

All-state API queries found **2 issues, both open, and 0 PRs**. Neither issue had
comments. This is a time-specific snapshot. No remote comments, closes or merges
were performed.

## Issue decisions

| Issue | Evidence and decision | Local handling |
|---|---|---|
| [#2: numeric pageId missing from guide](https://github.com/briqt/my-agent-browser/issues/2) | Valid. Upstream schema is `zod.number()`, and a string is rejected. | Add numeric examples and troubleshooting to SKILL.md. Keep validation upstream; do not silently coerce malformed calls. Real-browser checks cover rejection and successful numeric routing. |
| [#3: pin still at 1.11.0](https://github.com/briqt/my-agent-browser/issues/3) | Valid upgrade request. The old record proves 1.11 was tested, not that 1.12 was tested and rejected. | Move the tested/fallback version to 1.12.0, inspect schemas and run regression/browser tests. |

## Relevant 1.12 changes

- TaskRunner and per-page concurrency ([#3243](https://github.com/ChromeDevTools/chrome-devtools-mcp/pull/3243),
  [#3252](https://github.com/ChromeDevTools/chrome-devtools-mcp/pull/3252)) allow independent
  calls in the same MCP server to run concurrently. This is not action batching and
  does not provide a cross-process lock for separate Agents sharing Chrome.
- Focus emulation is deferred until a page is explicitly targeted
  ([#3230](https://github.com/ChromeDevTools/chrome-devtools-mcp/pull/3230)). This does
  not prove that GUI focus can never be stolen.
- Failed `new_page` closes its newly opened tab; snapshot wait and unread no-store
  response-body wait are bounded. These complement the existing wrapper recovery.
- `--watchConfig` hot reload concerns the **upstream** config, not this wrapper's
  config. Browser connection/launch settings still require restart. URL restriction
  changes leave already-attached targets attached.
- The release's “disallow --slim in CLI start options” applies to the separate
  `chrome-devtools start` CLI. `chrome-devtools-mcp --slim` remains valid according
  to its actual help. Slim tools omit normal pageId routing and bypass the wrapper's
  `evaluate_script`/`new_page` policies because their names/schemas differ. Keep the
  normal tool set for the documented wrapper workflow.

No change was needed in the inline function rewrite or background argument policy:
1.12 retains `function` / `sourcePath` / `format`, numeric `pageId`, and `background`.
Classic scripts and file sources remain upstream passthrough, with no claim of
stack-trace hiding for those modes.

See the installed skill's [compatibility record](../skills/my-agent-browser/references/dependency-upgrades.md)
for actual validation and limits, and [batching research](batch-actions-research-2026-11-05.md)
for the separate future work.
