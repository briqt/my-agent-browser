# Updates, Notices & Daemon Sync

There are three components to keep in mind:

| Object | Check | Update |
|---|---|---|
| CLI + bundled `chrome-devtools-mcp` | `my-agent-browser --version` / `doctor --json` | `npm i -g github:briqt/my-agent-browser --install-links` |
| Skill files | `metadata.version` in `SKILL.md` / `doctor --json` (`skillVersion`) | `npx skills add briqt/my-agent-browser -g -y` |
| Running daemon | `my-agent-browser status` / `doctor --json` (`daemon.version`) | Exits automatically on `idleTimeout`, or run `my-agent-browser restart` when safe |

Updating the CLI on disk does **not** kill a running daemon mid-session. Check `my-agent-browser status` (`canStopSafely`) before running `my-agent-browser restart`; never force-restart over another owner's active tabs without authorization.

## Update Checks

```bash
my-agent-browser check-update --json
```

- Queries the fixed repository feed (`https://raw.githubusercontent.com/briqt/my-agent-browser/main/notice.json`) with a 2-second timeout, 64 KiB cap, and no redirects.
- Low-frequency commands (`start`, `status`, `pages`) also run a best-effort check after completing (at most once per hour; 5-minute retry after failure; independent 24-hour cooldowns for version and announcement notices).
- High-frequency interaction commands (`click`, `fill`, `snap`, `eval`, `batch`, …), `doctor`, `config`, `--help`, and `--version` **never** touch the network.
- Reminders are written to `stderr` only and never alter `stdout` or exit codes. No updates are ever installed automatically.

## Disabling Update Checks

Any of the following disables both network checks and cached reminders:
- `"disable_update_check": true` in `~/.config/agent-skills/my-agent-browser/config.json`
- `MY_AGENT_BROWSER_NO_UPDATE_CHECK=1` (or `true`)
- `--no-update-check` flag on the CLI

## Publishing Checklist (Maintainers)

1. Update `package.json` (`version`), `npm install` (`package-lock.json`), `skills/my-agent-browser/SKILL.md` (`metadata.version`), `skills/my-agent-browser/scripts/start-mcp.js` (`STUB_VERSION`), and `CHANGELOG.md`.
2. Run `npm test` and `npm run test:e2e`.
3. Verify clean installation (`npm pack` / global install + `skills` copy) and check `my-agent-browser --version` and `my-agent-browser doctor --json`.
4. Commit, tag (`vX.Y.Z`), and push to GitHub so the immutable tag/commit is live and installable.
5. Only **after** the release tag is verified live, update root `notice.json` (`latest_version`, `release_url`, `notice_id`, `notice`) and push.
