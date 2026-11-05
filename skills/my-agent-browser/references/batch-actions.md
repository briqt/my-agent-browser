# Bounded browser actions — wrapper 1.5.0

`run_actions` combines known steps into one MCP tool call. It uses the existing
chrome-devtools-mcp input tools sequentially; it does not execute host JavaScript,
replace native events with DOM assignments, add a model, or make a transaction.

## When to choose it

Use native `fill_form` for several fields alone. Use a batch for an observed stable
form followed by a submit click, or a short known sequence of fill/hover operations.
Keep stepwise observation for unknown pages, dynamic choices and DOM rebuilds.
The batch trusts the caller's observed targets; unchanged URL/UID does not prove
unchanged page meaning. Repeated snapshots can retain IDs of unchanged nodes.

```json
{
  "pageId": 2,
  "actions": [
    {"tool": "fill_form", "arguments": {"elements": [
      {"uid": "1_7", "value": "Ada"},
      {"uid": "1_9", "value": "Example"}
    ]}},
    {"tool": "click", "arguments": {"uid": "1_12"}}
  ],
  "timeoutMs": 30000,
  "snapshot": "final",
  "snapshotFilePath": "/tmp/after-submit.txt"
}
```

All UIDs above are placeholders for IDs from the current page snapshot. Do not copy
them literally. `pageId` is a nonnegative integer. `actions` has 1–10 entries;
serialized arguments are limited to 64 KiB. The timeout includes discovery, actions
and the optional final snapshot (default 30 seconds, maximum 120 seconds).

| Tool | Accepted arguments | Position |
|---|---|---|
| `fill` | `uid`, `value` strings | Any |
| `fill_form` | `elements`: 1–50 `{uid,value}` entries | Any |
| `hover` | `uid` string | Any |
| `click` | `uid`, optional boolean `dblClick` | Last only |
| `press_key` | `key` string | Last only |

Each action must have `tool` and `arguments`. Cross-page overrides, per-step
snapshots, unknown fields/tools, empty identifiers and nested batches are rejected.
Top-level `snapshot` is `none` (default) or `final`; `snapshotFilePath` requires
`final`. File paths pass to upstream workspace validation without broadening roots.

All parameter **shapes** are checked before action dispatch. Upstream runtime rules
still apply (for example, valid keyboard key names, element readiness and page
permissions). A later runtime failure does not undo earlier actions. Do not use this
interface for scripts, multi-page navigation, dynamic branches, or auto-retries.

## Results and stopping

The result includes `status`, `completed`, `dispatched`, indexed `steps`, optional
`reason`, `snapshot` and `settling`. `dispatched` counts requested action attempts,
not internal discovery or the final snapshot. Per-step states are:

| State | Meaning / next action |
|---|---|
| `completed` | Upstream reported completion; do not repeat it blindly. |
| `failed` | Upstream returned an error. Partial effects remain possible; inspect first. |
| `interrupted` | Dialog/reconnect or potentially partial fill_form at a page boundary; inspect remaining fields. |
| `unknown` | Timeout, cancellation, lost transport or missing boundary signals; the action may have executed or may still run. |
| `not_run` | The wrapper did not dispatch this step. Re-plan with fresh observations. |

Any reported dialog, navigation, opened page or reconnect stops subsequent input.
A successful single-element action at the end that causes navigation/new pages counts as completed;
an explicit final snapshot can then run on the original `pageId`. A newly opened
page is not automatically targeted: use `list_pages` and observe it separately.
A fill_form crossing a boundary is conservatively interrupted, since some entries
may not have been filled. Dialog/unknown states skip final snapshots.

Snapshot status is independent of action completion. A failed/unknown final snapshot
sets the tool's `isError` but does not erase completed steps. Inline snapshot text is
capped at 12,000 characters with `truncated: true`; use a file for a full/heavy page.
Step reports omit input values and raw upstream messages that may echo them. An
explicit snapshot can contain form values and other page data. The wrapper omits
intermediate snapshots and does not return every upstream success message.

## Concurrency, deadlines and recovery

Only one batch can run per wrapper session. It is rejected while ordinary tool calls
are in flight; ordinary tool calls and other batches are rejected while it is active.
Requests are not silently queued for later execution with stale UIDs. Initialization,
roots replies and tool discovery still pass. Other MCP sessions and human interaction
can affect the same Chrome tab; `browser.lock` manages lifetime, not action isolation.

Timeout/cancellation stops further dispatch and sends best-effort upstream cancellation.
It **does not prove the current browser action stopped**. The response marks that step
unknown and retains the session's tool exclusion until the late response, recovery or
disconnect settles it. No final snapshot is issued concurrently with the unknown action.
If the session remains occupied, restart it and inspect the page before deciding what
remains. There is no automatic retry, replay or rollback.

On MCP replacement, internal requests are failed and never replayed. Partial reports
are flushed before process exit when the transport fails. Once a timed-out operation
settles, no second batch response is emitted and the abandoned sequence is not resumed.

## Availability and upgrade

Install wrapper 1.5.0 and `chrome-devtools-mcp@1.12.0`, then restart the MCP session.
`version.json` and `--doctor --json` identify the actual wrapper/dependency combination.
`mcp.batchActions` defaults to `true`; set it to `false` and restart to disable.
A different installed MCP version keeps native tools but does not enable wrapper batching.

When enabled, the wrapper supplies `--experimentalStructuredContent=true` to upstream,
because 1.12 otherwise drops its dialog/navigation/opened-page fields. Native tool
responses consequently also include structured data. Disabling wrapper batching stops
this automatic flag; explicit upstream flags still apply. Do not disable these signals
through upstream hot reload while using batches: missing signals stop further dispatch.

Every batch rediscovers the full upstream tool list (including pagination), so flags,
config reloads and recovery cannot silently reuse an old capability cache. Only known
compatible native input tools are offered. Slim tools or disabled pageId routing do
not expose this compound tool. No arbitrary upstream JSON Schema is interpreted.

Update notices describe availability; they do not install or restart anything. See
[update-checks.md](update-checks.md) for the two installation paths and opt-out.
