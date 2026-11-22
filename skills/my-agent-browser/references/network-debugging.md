# Network Debugging & Mocking

Inspect live requests/responses and (optionally) override responses per page.

## Default Network Inspection Tools

Enabled by default (disable only if shrinking tool count via `"--no-categoryNetwork"` in `mcp.flags`):

| Command | Purpose |
|---|---|
| `my-agent-browser network <pageId> [--resource-types <type...>]` | List captured requests (`list_network_requests`) |
| `my-agent-browser get_network_request <pageId> --reqid <id>` | Inspect full headers, bodies, and timing (or save via `--request-file-path` / `--response-file-path`) |

### Supported `--resource-types` Filters

`document`, `stylesheet`, `image`, `media`, `font`, `script`, `texttrack`, `xhr`, `fetch`,
`prefetch`, `eventsource`, `manifest`, `signedexchange`, `ping`, `cspviolationreport`,
`preflight`, `fedcm`, `other`. *(Note: `websocket` is not supported as a filter in upstream 1.12+.)*

### Core Workflow: Diagnose Failing API Calls

```bash
my-agent-browser goto 1 "https://app.example.com/dashboard"
my-agent-browser click 1 1_20
my-agent-browser network 1 --resource-types fetch --resource-types xhr
# → Find failing reqid (e.g. reqid=7, status=403)
my-agent-browser get_network_request 1 --reqid 7 --response-file-path /tmp/api-err.json
```

Binary request/response bodies are preserved byte-for-byte when saved to disk.

## Page-Scoped Network Mocking (Opt-In, Upstream 1.13+)

Add `"--categoryNetworkMocks"` to `mcp.flags` in `config.json` and run `my-agent-browser restart`.

```bash
# Replace a remote script or API response with a local file (re-read on every request, survives reloads)
my-agent-browser mock_network 1 --route "https://example.com/app.js*" --body /tmp/local-app.js

# Or redirect GET/HEAD requests to another HTTP(S) upstream URL
my-agent-browser mock_network 1 --route "https://api.example.com/v1/*" --upstream "http://127.0.0.1:4000/v1/"

# Inspect active mocks and hit counts on page 1
my-agent-browser mock_network 1

# Remove specific mock or clear all mocks on page 1
my-agent-browser remove_network_mock 1 --route "https://example.com/app.js*"
my-agent-browser remove_network_mock 1
```

> Active mocks disable the page HTTP cache and intercept requests on that tab, so Lighthouse and performance traces include a measurement warning until the last mock is removed.
