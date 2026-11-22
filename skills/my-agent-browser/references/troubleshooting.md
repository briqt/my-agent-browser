# Troubleshooting

Start with `my-agent-browser doctor --json`. It checks CLI/Skill/Node/Chrome/engine paths,
validates `config.json`, and inspects any running daemon **without launching Chrome**.

## Common Issues

| Symptom | Cause | Action |
|---|---|---|
| `command not found: my-agent-browser` | CLI not installed or global npm bin missing from `PATH` | `npm i -g github:briqt/my-agent-browser --install-links` |
| `my_agent_browser_mcp_deprecated` in MCP tools | Leftover v1.x MCP entry still configured in your agent | Remove the legacy `start-mcp.js` MCP server using your agent's own MCP settings |
| `Page <id> is owned by '<owner>'` | Tab is locked to another agent | Open your own tab (`open <url> --owner <you>`), pass matching `--owner`, or `--force` if takeover is authorized |
| `Refusing to stop browser: owner '...' holds page(s)` | Another agent has active locked tab(s) | Close only your own tab (`close-page <id>`); inspect `my-agent-browser status` |
| `No page found` / invalid `pageId` | Tab was closed or daemon restarted | Run `my-agent-browser pages` and use a current numeric `pageId` |
| Click/fill does nothing or fails | Stale UID after DOM update | Run `my-agent-browser snap <pageId>` for fresh UIDs |
| `wait-for` times out when text looks visible | `snap` collapses whitespace, whereas DOM text preserves newlines/multiple spaces (case-sensitive) | Pass a shorter distinctive substring to `wait-for` |
| `press` cannot select option in `<select>` on macOS | macOS renders native `<select>` menus outside DOM keyboard routing | Use `fill <pageId> <uid> "<value>"` or `eval` setting `.value` and dispatching `change` |
| Browser hangs or times out on huge pages | Heavy DOM (editors, large tables, long chats) | Save snapshot to disk (`snap <pageId> /tmp/page.txt`) and read slices with `tail` / `grep`; keep `--include-snapshot` off |
| Chrome fails to start in Docker / Linux | Sandbox or missing display | Ensure `"headless": true` and add `"--no-sandbox"` to `browser.extraArgs` if running in a container |
| Bot / anti-automation block | Usually exit IP, WebGL renderer, or `HeadlessChrome` UA | Route via `browser.proxy`, verify WebGL renderer, or `restart --headed` — see [anti-detection.md](anti-detection.md) |

## Timeouts & In-Flight Actions

- Default client RPC timeout is `65000ms` (automatically extended when `--timeout` / `--timeout-ms` is larger, or override via `--rpc-timeout-ms <ms>`).
- **Timeout is not rollback**: If a mutating command (`click`, `batch`, `eval`) times out, the browser action may still finish settling. **Never blindly resend a mutation** — run `my-agent-browser snap <pageId>` to verify page state first.

## Batch (`run_actions`) Diagnostics

- `status: "rejected"` (`dispatched: 0`): Parameter shape failed validation before any browser action ran.
- `status: "stopped"`, step `interrupted`: A JS dialog opened (`dialog <pageId> accept`), browser reconnected, or `fill_form` hit a navigation mid-form.
- `status: "stopped"`, step `unknown` (`settling: true`): Step timed out or disconnected; wait for settlement and inspect with `snap` before continuing.
