"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawnSync } = require("node:child_process");

const CLI_PATH = path.resolve(__dirname, "..", "src", "cli.js");

function runCli(args, env, timeout = 15000) {
  const res = spawnSync(process.execPath, [CLI_PATH, "--no-update-check", ...args], {
    env,
    encoding: "utf8",
    timeout,
  });
  return res;
}

// Create a fake chrome-devtools-mcp package in a temp directory so daemon IPC,
// owner locks, screenshot saving, and idle timeout can be tested deterministically
// in milliseconds without launching a real browser!
function createMockEnvironment({ idleTimeout = "30m" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mab-daemon-test-"));
  const home = path.join(root, "home");
  const binDir = path.join(root, "bin");
  const pkgDir = path.join(binDir, "node_modules", "chrome-devtools-mcp");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(pkgDir, { recursive: true });

  const mockMcpEntry = path.join(pkgDir, "mock-mcp.js");
  fs.writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify({
      name: "chrome-devtools-mcp",
      version: require("../package.json").dependencies["chrome-devtools-mcp"],
      bin: { "chrome-devtools-mcp": "./mock-mcp.js" },
    })
  );

  // Mock MCP server over stdio keeping in-memory tabs
  fs.writeFileSync(
    mockMcpEntry,
    `#!/usr/bin/env node
"use strict";
let nextId = 1;
const pages = [{ id: 1, title: "Initial", url: "about:blank", selected: true }];
const tools = [
  { name: "list_pages", description: "List pages", inputSchema: { type: "object", properties: {} } },
  { name: "new_page", description: "New page", inputSchema: { type: "object", required: ["url"], properties: { url: { type: "string" }, background: { type: "boolean" } } } },
  { name: "close_page", description: "Close page", inputSchema: { type: "object", required: ["pageId"], properties: { pageId: { type: "number" } } } },
  { name: "take_snapshot", description: "Snapshot", inputSchema: { type: "object", required: ["pageId"], properties: { pageId: { type: "number" } } } },
  { name: "take_screenshot", description: "Screenshot", inputSchema: { type: "object", required: ["pageId"], properties: { pageId: { type: "number" } } } },
  { name: "click", description: "Click", inputSchema: { type: "object", required: ["pageId", "uid"], properties: { pageId: { type: "number" }, uid: { type: "string" } } } }
];
function formatPages() {
  return pages.map(p => p.id + ": " + p.title + " (" + p.url + ")" + (p.selected ? " [selected]" : "")).join("\\n");
}
let buf = "";
process.stdin.on("data", chunk => {
  buf += chunk.toString();
  const lines = buf.split("\\n"); buf = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (!msg.id) continue;
    if (msg.method === "initialize") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "mock", version: "1" } } }) + "\\n");
    } else if (msg.method === "tools/list") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools } }) + "\\n");
    } else if (msg.method === "tools/call") {
      const { name, arguments: a } = msg.params;
      if (name === "new_page") {
        for (const p of pages) p.selected = false;
        const created = { id: ++nextId, title: "Tab " + nextId, url: a.url, selected: true };
        pages.push(created);
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { isError: false, content: [{ type: "text", text: formatPages() }], structuredContent: { pages } } }) + "\\n");
      } else if (name === "list_pages") {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { isError: false, content: [{ type: "text", text: formatPages() }], structuredContent: { pages } } }) + "\\n");
      } else if (name === "close_page") {
        const idx = pages.findIndex(p => p.id === a.pageId);
        if (idx !== -1) pages.splice(idx, 1);
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { isError: false, content: [{ type: "text", text: formatPages() }], structuredContent: { pages } } }) + "\\n");
      } else if (name === "take_snapshot") {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { isError: false, content: [{ type: "text", text: "uid=1_1 button \\"OK\\"" }], structuredContent: {} } }) + "\\n");
      } else if (name === "take_screenshot") {
        const png1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { isError: false, content: [{ type: "image", mimeType: "image/png", data: png1x1 }], structuredContent: {} } }) + "\\n");
      } else if (name === "click") {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { isError: false, content: [{ type: "text", text: "Clicked " + a.uid }], structuredContent: {} } }) + "\\n");
      }
    }
  }
});
`
  );
  fs.chmodSync(mockMcpEntry, 0o755);

  // Use direct browserUrl mode + NODE_PATH override? No, resolveMcpPackage uses bundled first unless we override!
  // Wait: let's also point browserUrl to a dummy local URL so daemon runs in direct mode without launching real Chrome!
  fs.writeFileSync(
    path.join(home, "config.json"),
    JSON.stringify({
      disable_update_check: true,
      browser: {
        browserUrl: "http://127.0.0.1:9",
        idleTimeout,
      },
    })
  );

  // Redirect require.resolve('chrome-devtools-mcp/package.json') in child daemon via NODE_OPTIONS --require hook
  const preload = path.join(root, "preload-mock-mcp.js");
  fs.writeFileSync(
    preload,
    `const Module = require("node:module");
const orig = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
  if (request === "chrome-devtools-mcp/package.json") return ${JSON.stringify(path.join(pkgDir, "package.json"))};
  return orig.call(this, request, parent, isMain, options);
};`
  );

  const env = {
    ...process.env,
    MY_AGENT_BROWSER_HOME: home,
    NODE_OPTIONS: `--require "${preload.replace(/\\/g, "/")}"`,
  };

  return {
    root,
    home,
    env,
    cleanup() {
      try { runCli(["stop", "--force"], env, 5000); } catch {}
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test("status and doctor never spawn daemon; owner locks protect tabs and stop/restart", () => {
  const ctx = createMockEnvironment({ idleTimeout: "never" });
  try {
    // 1. Offline status does not start daemon
    const st0 = JSON.parse(runCli(["status", "--json"], ctx.env).stdout);
    assert.equal(st0.running, false);
    assert.equal(st0.configuredIdleTimeout, "never");

    // 2. Agent A opens a tab with --owner agent-a
    const openA = runCli(["open", "https://example.com/a", "--owner", "agent-a", "--json"], ctx.env);
    assert.equal(openA.status, 0, openA.stderr);

    // 3. Agent B checks pages & status: discovers agent-a owns page 2 and canStopSafely is false!
    const stB = JSON.parse(runCli(["status", "--owner", "agent-b", "--json"], ctx.env).stdout);
    assert.equal(stB.running, true);
    assert.equal(stB.idleTimeout, "never");
    assert.equal(stB.canStopSafely, false);
    assert.deepEqual(stB.activeOwners.map((o) => o.owner), ["agent-a"]);
    assert.deepEqual(stB.activeOwners[0].pageIds, [2]);

    // Same owner sees canStopSafely: true
    const stA = JSON.parse(runCli(["status", "--owner", "agent-a", "--json"], ctx.env).stdout);
    assert.equal(stA.canStopSafely, true);

    // 4. Read-only snap on page 2 works for Agent B
    const snapB = runCli(["snap", "2", "--owner", "agent-b"], ctx.env);
    assert.equal(snapB.status, 0, snapB.stderr);
    assert.match(snapB.stdout, /uid=1_1/);

    // 5. Mutating click & close-page on page 2 by Agent B (or unset owner) are rejected!
    const clickB = runCli(["click", "2", "1_1", "--owner", "agent-b"], ctx.env);
    assert.equal(clickB.status, 1);
    assert.match(clickB.stderr, /Page 2 is owned by 'agent-a', caller is 'agent-b'/);

    const stopB = runCli(["stop", "--owner", "agent-b"], ctx.env);
    assert.equal(stopB.status, 1);
    assert.match(stopB.stderr, /Refusing to stop browser: owner 'agent-a' holds page\(s\) \[2\]/);

    // 6. Inline screenshot saves to disk instead of dumping base64
    const shot = JSON.parse(runCli(["shot", "2", "--json"], ctx.env).stdout);
    assert.equal(shot.ok, true);
    const savedFile = shot.structuredContent.savedImages[0].filePath;
    assert.ok(fs.existsSync(savedFile));
    assert.ok(fs.statSync(savedFile).size > 20);
    fs.unlinkSync(savedFile);

    // 7. Agent A can click and close its own tab; afterwards Agent B can safely stop daemon
    assert.equal(runCli(["click", "2", "1_1", "--owner", "agent-a"], ctx.env).status, 0);
    assert.equal(runCli(["close-page", "2", "--owner", "agent-a"], ctx.env).status, 0);

    const stopNow = runCli(["stop", "--owner", "agent-b"], ctx.env);
    assert.equal(stopNow.status, 0, stopNow.stderr);
    assert.equal(JSON.parse(runCli(["status", "--json"], ctx.env).stdout).running, false);
  } finally {
    ctx.cleanup();
  }
});

test("claim, release, and --force takeover work as expected", () => {
  const ctx = createMockEnvironment({ idleTimeout: "30m" });
  try {
    assert.equal(runCli(["pages"], ctx.env).status, 0);
    assert.equal(runCli(["claim", "1", "--owner", "alpha"], ctx.env).status, 0);
    assert.equal(runCli(["click", "1", "1_1", "--owner", "beta"], ctx.env).status, 1);
    assert.equal(runCli(["click", "1", "1_1", "--owner", "beta", "--force"], ctx.env).status, 0);
    assert.equal(runCli(["release", "1", "--owner", "alpha"], ctx.env).status, 0);
    assert.equal(runCli(["click", "1", "1_1", "--owner", "beta"], ctx.env).status, 0);
  } finally {
    ctx.cleanup();
  }
});

test("idleTimeout automatically closes an inactive daemon", async () => {
  const ctx = createMockEnvironment({ idleTimeout: "300ms" });
  try {
    assert.equal(runCli(["start"], ctx.env).status, 0);
    assert.equal(JSON.parse(runCli(["status", "--json"], ctx.env).stdout).running, true);
    await new Promise((r) => setTimeout(r, 650));
    assert.equal(JSON.parse(runCli(["status", "--json"], ctx.env).stdout).running, false);
  } finally {
    ctx.cleanup();
  }
});
