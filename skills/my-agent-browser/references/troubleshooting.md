# Troubleshooting

Start with `my-agent-browser doctor --json`. It checks CLI/Skill/Node/Chrome/engine paths, validates `config.json`, and inspects any running daemon **without launching Chrome**.

## Common Issues

| Symptom | Cause | Action |
|---|---|---|
| `command not found: my-agent-browser` | CLI not installed or global npm bin missing from `PATH` | `npm i -g github:briqt/my-agent-browser --install-links` |
| `my_agent_browser_mcp_deprecated` in MCP tools | Leftover v1.x MCP entry still configured | Remove the legacy `start-mcp.js` MCP server in your agent settings |
| `Page <id> is owned by '<owner>'` | Tab is locked to another agent | Open your own tab (`open <url> --owner <you>`), pass matching `--owner`, or `--force` if authorized |
| `Refusing to stop browser: owner '...' holds page(s)` | Another agent holds locked tab(s) | Close only your own tab (`close-page <id>`); inspect `my-agent-browser status` |
| `No page found` / invalid `pageId` | Tab was closed or daemon restarted | Run `my-agent-browser pages` for current numeric IDs |
| Click/fill does nothing or fails | Stale UID after DOM update | Run `my-agent-browser snap <pageId>` for fresh UIDs |
| `wait-for` times out when text looks visible | `snap` normalizes whitespace; DOM text keeps newlines/spaces (case-sensitive) | Pass a shorter distinctive substring |
| `press` cannot select option in `<select>` on macOS | OS-rendered native `<select>` menu | Use `fill <pageId> <uid> "<value>"` or `eval` setting `.value` + `change` event |
| Browser hangs or times out on huge pages | Heavy DOM (editors, large tables, long chats) | Save snapshot to disk (`snap <pageId> /tmp/page.txt`) and inspect slices with `tail` / `grep`; keep `--include-snapshot` off |
| Chrome fails to start in Docker / Linux | Sandbox or missing display | Keep `"headless": true` and add `"--no-sandbox"` to `browser.extraArgs` |
| Bot / anti-automation block | Exit IP, WebGL renderer, or `HeadlessChrome` UA | Route via `browser.proxy`, check WebGL renderer, or `restart --headed` — see [anti-detection.md](anti-detection.md) |

## Timeouts & In-Flight Actions

- Default client RPC timeout is `65000ms` (automatically extended when `--timeout` is larger, or override via `--rpc-timeout-ms <ms>`).
- **Timeout is not rollback**: If a mutating command (`click`, `eval`, `fill-form`) times out, the action may still complete. Inspect page state with `my-agent-browser snap <pageId>` before retrying.
