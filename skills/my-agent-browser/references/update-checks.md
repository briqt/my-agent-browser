# Updates, Notices & Daemon Sync

| Component | Check | Update |
|---|---|---|
| CLI + bundled `chrome-devtools-mcp` | `my-agent-browser --version` / `doctor --json` | `npm i -g github:briqt/my-agent-browser --install-links` |
| Skill files | `metadata.version` in `SKILL.md` / `doctor --json` (`skillVersion`) | `npx skills add briqt/my-agent-browser -g -y` |
| Running daemon | `my-agent-browser status` / `doctor --json` (`daemon.version`) | Exits on `idleTimeout`, or run `my-agent-browser restart` when safe |

Updating the CLI does **not** kill a running daemon mid-session. Check `my-agent-browser status` (`canStopSafely`) before running `my-agent-browser restart`.

## Update Checks

```bash
my-agent-browser check-update --json
```

- Queries `https://raw.githubusercontent.com/briqt/my-agent-browser/main/notice.json` (2s timeout, 64 KiB cap, no redirects).
- Low-frequency commands (`start`, `status`, `pages`) run a best-effort check after completing (at most once/hour; 5m retry after failure; 24h notification cooldowns).
- High-frequency commands (`click`, `fill`, `snap`, `eval`, …), `doctor`, `config`, `--help`, and `--version` never touch the network.
- Notices print to `stderr` only and never alter `stdout` or exit codes.

## Disabling Update Checks

- `"disable_update_check": true` in `~/.config/agent-skills/my-agent-browser/config.json`
- `MY_AGENT_BROWSER_NO_UPDATE_CHECK=1` (or `true`)
- `--no-update-check` CLI flag

## Publishing Checklist (Maintainers)

1. Update `package.json` (`version`), `package-lock.json`, `skills/my-agent-browser/SKILL.md` (`metadata.version`), `skills/my-agent-browser/scripts/start-mcp.js` (`STUB_VERSION`), and `CHANGELOG.md`.
2. Run `npm test` and `npm run test:e2e`.
3. Verify clean installation and check `my-agent-browser --version` and `my-agent-browser doctor --json`.
4. Commit, tag (`vX.Y.Z`), and push to GitHub.
5. After the tag is live, update `notice.json` and push.
