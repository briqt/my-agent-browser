# Network Debugging

Guide for debugging network requests using the Network category tools.

**Required flag:** `--categoryNetwork` in `mcp.flags`

## Available Tools

| Tool | Purpose |
|------|---------|
| `list_network_requests` | List captured network requests (filterable by resource type) |
| `get_network_request { reqid }` | Get full request/response details for a specific request |

## Resource Types

When filtering with `list_network_requests`, common resource types:

| Type | What it captures |
|------|-----------------|
| `xhr` | XMLHttpRequest calls |
| `fetch` | Fetch API calls |
| `document` | HTML page loads |
| `stylesheet` | CSS files |
| `script` | JavaScript files |
| `image` | Images (png, jpg, svg, etc.) |
| `font` | Web fonts |
| `websocket` | WebSocket connections |
| `media` | Audio/video resources |

## Core Workflow

```
1. navigate_page { url: "https://app.example.com" }
2. take_snapshot → interact with the page (click buttons, submit forms)
3. list_network_requests
   → Returns: list of requests with reqid, url, method, status, resourceType, size
4. get_network_request { reqid: "req_15" }
   → Returns: full headers, request body, response body, timing breakdown
```

## Workflow: Find Why an API Call Is Failing

```
1. navigate_page { url: "https://app.example.com/dashboard" }
2. take_snapshot
3. click { uid: "1_20" }  — trigger the action that fails
4. wait_for { text: ["Error"] }  — or just wait a moment
5. list_network_requests
   → Look for requests with status 4xx or 5xx
   → Example output:
     reqid=req_7  POST https://api.example.com/data  status=403  type=fetch
     reqid=req_8  GET https://api.example.com/user   status=200  type=fetch
6. get_network_request { reqid: "req_7" }
   → Shows:
     - Request headers (check Authorization, Content-Type)
     - Request body (check payload format)
     - Response headers
     - Response body (error message from server)
     - Timing (DNS, connect, TLS, waiting, download)
```

## Workflow: Identify Slow Requests

```
1. navigate_page { url: "https://slow-app.example.com" }
2. wait_for { text: ["Ready"] }
3. list_network_requests
   → Look at timing/size columns to find outliers
   → Sort mentally by response time or size
4. get_network_request { reqid: "req_12" }
   → Check timing breakdown:
     - DNS lookup: was resolution slow?
     - Connection: TCP/TLS handshake delay?
     - Waiting (TTFB): server processing time?
     - Download: large payload?
```

## Workflow: Verify API Request Format

When debugging form submissions or API integrations:

```
1. navigate_page { url: "https://app.example.com/form" }
2. take_snapshot → fill the form
3. fill { uid: "1_5", value: "test data" }
4. click { uid: "1_10" }  — submit
5. list_network_requests
   → Find the POST/PUT request
6. get_network_request { reqid: "req_5" }
   → Verify:
     - Content-Type header matches expected (application/json vs form-data)
     - Request body has correct field names and values
     - Authorization header is present and valid
```

## Workflow: Check What Resources a Page Loads

```
1. navigate_page { url: "https://example.com" }
2. list_network_requests
   → See all resources: documents, scripts, stylesheets, images, fonts, API calls
   → Useful for:
     - Finding third-party scripts (analytics, ads)
     - Identifying large resources slowing the page
     - Checking if resources load from CDN vs origin
     - Verifying caching headers
```

## Tips

### Filtering Large Request Lists

Pages often make 50-100+ requests. Focus your investigation:
- Filter by type (`fetch` or `xhr`) to see only API calls
- Look at status codes: 4xx/5xx indicate failures
- Look at large sizes: may indicate uncompressed or oversized responses
- Look at the URL path to identify the relevant endpoint

### Timing Interpretation

When `get_network_request` returns timing data:
- High DNS time → DNS resolution issue, consider preconnect
- High connect time → server far away or overloaded
- High TTFB (waiting) → server processing is slow
- High download time → response payload too large, consider compression

### Request Ordering

Requests are listed in chronological order. The first requests are typically:
1. The HTML document
2. CSS and JS referenced in the HTML
3. Fonts and images referenced in CSS
4. API calls triggered by JavaScript

Later requests are usually triggered by user interaction or lazy loading.

### Combining with Console

If an API call fails, also check `list_console_messages` — the application may
log additional error context (parsed error messages, retry attempts, fallback behavior).

### Combining with Performance

Use `performance_start_trace` / `performance_stop_trace` alongside network
inspection to correlate slow requests with rendering delays. The performance
trace shows when the browser was blocked waiting for resources.

## Common Patterns

### CORS Failure
- Request shows status 0 or is missing from the list
- Check console for "Access-Control-Allow-Origin" errors
- The preflight OPTIONS request may have failed

### Authentication Failure
- Status 401 or 403
- Check if Authorization header is present in request
- Check if token is expired (decode JWT from the header)

### Redirect Chain
- Status 301/302 followed by another request to the redirect target
- Multiple redirects slow down page load

### Missing Content-Type
- Server returns 200 but response body is garbled
- Check Content-Type header in response — may be wrong encoding
