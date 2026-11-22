# Bounded Browser Actions (`batch`)

`my-agent-browser batch` (backed by the daemon's `run_actions` engine) combines up to
10 known, stable steps on a single page into one call with automatic boundary detection.

## When to use `fill-form` vs `batch` vs shell `&&`

- **Multiple inputs only**: Prefer `my-agent-browser fill-form <pageId> <uid=val...>`.
- **Known form + submit click/key (with boundary safety)**: Prefer `my-agent-browser batch`:
  ```bash
  my-agent-browser batch 2 '[
    {"tool": "fill_form", "arguments": {"elements": [
      {"uid": "1_7", "value": "Ada"},
      {"uid": "1_9", "value": "Example"}
    ]}},
    {"tool": "click", "arguments": {"uid": "1_12"}}
  ]' --snapshot final --snapshot-file /tmp/after-submit.txt
  ```
- **Dynamic flows where step 2 depends on step 1's DOM change**: Keep stepwise `action → snap → decide`.

## Supported Steps & Constraints

- `pageId`: nonnegative integer (all steps execute on this single tab).
- `actions`: 1–10 items, serialized payload <= 64 KiB, timeout 1–120000 ms (default `30000` via `--timeout-ms`).
- You can also load the action array from a JSON file via `--file /tmp/plan.json`.

| Tool | Accepted `arguments` | Allowed Position |
|---|---|---|
| `fill` | `{ "uid": "...", "value": "..." }` | Any |
| `fill_form` | `{ "elements": [{ "uid": "...", "value": "..." }] }` (1–50 items) | Any |
| `hover` | `{ "uid": "..." }` | Any |
| `click` | `{ "uid": "...", "dblClick"?: boolean }` | **Last step only** |
| `press_key` | `{ "key": "..." }` | **Last step only** |

All parameter shapes are validated **before** the first step runs: an invalid step 3
rejects the entire batch with `dispatched: 0`.

## Boundary Detection & Step States

With `chrome-devtools-mcp@1.13.0`, upstream structured signals detect:
- **Dialogs** (`alert` / `confirm` / `prompt`)
- **Navigations** — including **same-URL reloads and form POSTs back to the same URL** (upstream `#3395`)
- **Newly opened tabs/popups**
- **Browser reconnects**

Any boundary or error stops remaining steps immediately. Step reports omit input values
so credentials are never echoed in error summaries.

| Step `status` | Meaning & Next Action |
|---|---|
| `completed` | Step finished cleanly (including a terminal `click` / `press_key` that navigated). Do not repeat blindly. |
| `failed` | Upstream returned an error (e.g. stale UID after DOM rebuild). Inspect with `snap` before retrying. |
| `interrupted` | Dialog opened, browser reconnected, or `fill_form` crossed a page boundary mid-fill. Handle dialog (`dialog <pageId> accept`) and `snap`. |
| `unknown` | Timeout, client disconnect, or recovery mid-step. The browser action may have executed or may still be settling (`settling: true`). **Never resend blindly** — wait/inspect first. |
| `not_run` | Step was never dispatched because an earlier step stopped the batch. |

## Concurrency & Ownership

- If `pageId` is locked to an `--owner`, `batch` checks ownership upfront before dispatching any step.
- Only one `batch` runs at a time in the daemon; concurrent tool calls wait/reject cleanly while a timed-out step settles so commands never interleave with unfinished input.
- Separate agents sharing Chrome must still work in separate tabs (`open <url> --owner <agent>`).
