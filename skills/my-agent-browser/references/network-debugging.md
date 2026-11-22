# Network Debugging & Mocking

Inspect live requests/responses and override responses per page — all network tools are enabled out of the box.

## Network Inspection

| Command | Purpose |
|---|---|
| `my-agent-browser network <pageId> [--resource-types <type...>]` | List captured requests (`list_network_requests`) |
| `my-agent-browser get_network_request <pageId> --reqid <id>` | Inspect full headers, bodies, and timing (`--request-file-path` / `--response-file-path`) |

Supported `--resource-types`: `document`, `stylesheet`, `image`, `media`, `font`, `script`, `texttrack`, `xhr`, `fetch`, `prefetch`, `eventsource`, `manifest`, `signedexchange`, `ping`, `cspviolationreport`, `preflight`, `fedcm`, `other`.

```bash
my-agent-browser goto 1 "https://app.example.com/dashboard"
my-agent-browser click 1 1_20
my-agent-browser network 1 --resource-types fetch --resource-types xhr
my-agent-browser get_network_request 1 --reqid 7 --response-file-path /tmp/api-err.json
```

Binary request/response bodies are preserved byte-for-byte when saved to disk.

## Page-Scoped Network Mocking

Enabled by default (`mock_network` / `remove_network_mock`):

```bash
# Replace a remote script or API response with a local file (re-read per request, survives reloads)
my-agent-browser mock_network 1 --route "https://example.com/app.js*" --body /tmp/local-app.js

# Or redirect GET/HEAD requests to another HTTP(S) upstream URL
my-agent-browser mock_network 1 --route "https://api.example.com/v1/*" --upstream "http://127.0.0.1:4000/v1/"

# Inspect active mocks and hit counts on page 1
my-agent-browser mock_network 1

# Remove specific mock or clear all mocks on page 1
my-agent-browser remove_network_mock 1 --route "https://example.com/app.js*"
my-agent-browser remove_network_mock 1
```

> Active mocks disable the page HTTP cache and intercept requests on that tab until the last mock is removed.
