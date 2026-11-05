# Updates and announcements

`version.json` is the installed wrapper's version source and records its tested MCP
version. `--version`, `--doctor` and the update checker read it. The separately
installed `chrome-devtools-mcp` has its own package version; updating the skill does
not update that dependency or replace an already-running MCP session.

```bash
node <skill-dir>/scripts/start-mcp.js --check-update --json
npx skills update my-agent-browser -g -y
npm install -g chrome-devtools-mcp@1.12.0
node <skill-dir>/scripts/start-mcp.js --doctor --json
```

Then restart the MCP session. For a first installation, or to reinstall the skill,
use `npx skills add briqt/my-agent-browser -g -y`.

## Behavior

The MCP wrapper starts one asynchronous check per session, without waiting for it
before initializing the MCP transport. Long-running sessions do not poll; another
session or an explicit check refreshes the feed. There is no extra daemon.

- Fixed endpoint: `https://raw.githubusercontent.com/briqt/my-agent-browser/main/notice.json`.
  Requests contain no browser config, profile, URLs or business data.
- Whole network operation: at most 2 seconds, 64 KiB body, no redirects. Invalid
  schemas, prerelease/invalid versions and URLs outside this repository are rejected.
- Check interval: 1 hour after success; 5 minutes after failure. Explicit
  `--check-update` bypasses this interval, but still respects the notification cooldown.
- Version and announcement reminders have independent 24-hour cooldowns. New
  versions/new notice IDs can notify immediately. Only a version greater than the
  installed stable version triggers an upgrade reminder.
- Old cache survives failed checks but expires after 7 days. A successfully fetched
  empty notice withdraws it. Clock rollback resets the timing state.
- Notices are display data, with terminal control characters removed. No downloads,
  installs or remote commands are executed. Installation instructions come from local code.
- Hints always go to stderr. JSON/stdout stays parseable; optional check failures do
  not change the MCP business result or exit code. Explicit checks report their status,
  including unavailable/busy/disabled, and still exit successfully.

Disable both networking and cached reminders using `disable_update_check: true` in
config, or `--no-update-check`. This includes explicit checks. It only controls this
wrapper, not the upstream MCP's independent update checker. `--help`, `--version`,
`--doctor` and `--init-config` never run this check.

Cache and lock: `~/.config/agent-skills/my-agent-browser/update_check.json` and
`update_check.lock`; `MY_AGENT_BROWSER_HOME` redirects all wrapper runtime data.
Cache writes use unique temporary files and atomic rename. Concurrent checks take a
nonblocking process lock; other callers skip. A lock belonging to a dead process is
reclaimed. An interrupted lock creation/reclamation may leave an unreadable lock or
`update_check.lock.reap` directory: with wrapper processes stopped, those cache lock
artifacts can be removed. Never delete `user-data` to repair an update check.
Unwritable cache/lock locations silently skip automatic checks.

## Configuration setup

`node <skill-dir>/scripts/start-mcp.js --init-config` creates the user config from
`config.example.json`, without overwriting an existing file. The historical template
name is retained for installation compatibility. Missing config still permits the
wrapper's existing built-in defaults. Selected invalid config fails with exit 1.

The normal config is `$MY_AGENT_BROWSER_HOME/config.json` when that variable is set,
otherwise `~/.config/agent-skills/my-agent-browser/config.json`. Only with the explicit
`--dev-config` option does `<skill-dir>/.config.json` take precedence. Files are not
merged; neither loading nor update checking writes into the installation directory.

## Publishing

1. Change `version.json` and the release documentation; run unit/documentation tests
   and the isolated browser checks against `tested_mcp_version`.
2. Verify a real `skills` install contains `version.json`, scripts, references and
   configuration templates. Check its `--version` and `--doctor` output.
3. Publish the code and verify the immutable commit/tag is installable. If using a
   tag, its version must match `version.json`. Do not announce a local-only version.
4. Only then update the repository-root `notice.json`: set `latest_version` from that
   published metadata and `release_url` to its immutable commit or release tag.
   Use `schema_version: 1`. Independent announcements use a new `notice_id` plus
   `notice`; withdraw by setting both to empty strings.

The feed describes the latest published and verified version, which can lag a local
working tree. An unavailable feed is not evidence that the installation is current.
