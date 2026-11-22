"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const {
  checkUpdate,
  isUpdateDisabled,
  stableVersion,
  newer,
  validateManifest,
  notifications,
} = require("../src/update-check.js");

const STUB_PATH = path.resolve(__dirname, "..", "skills", "my-agent-browser", "scripts", "start-mcp.js");

test("SemVer comparison and manifest validation enforce strict safety rules", () => {
  assert.deepEqual(stableVersion("v2.0.0"), [2n, 0n, 0n]);
  assert.equal(stableVersion("2.0.0-beta.1"), null);
  assert.equal(newer("2.0.0", "1.5.0"), true);
  assert.equal(newer("2.0.0", "2.0.0"), false);
  assert.equal(newer("1.10.0", "1.9.0"), true);

  const valid = validateManifest({
    schema_version: 1,
    latest_version: "2.0.0",
    release_url: "https://github.com/briqt/my-agent-browser/releases/tag/v2.0.0",
    notice_id: "v2.0.0-cli",
    notice: "Moved to CLI\x1b[31m!",
  });
  assert.equal(valid.latest_version, "2.0.0");
  assert.ok(!valid.notice.includes("\x1b"));

  assert.throws(() =>
    validateManifest({
      schema_version: 1,
      latest_version: "2.0.0",
      release_url: "https://evil.example.com/briqt/my-agent-browser/releases/tag/v2.0.0",
      notice_id: "",
      notice: "",
    })
  );
});

test("checkUpdate throttles network, respects 24h cooldowns, and honors all opt-outs", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mab-upd-"));
  try {
    let calls = 0;
    const mockFetch = async () => {
      calls++;
      const payload = JSON.stringify({
        schema_version: 1,
        latest_version: "2.1.0",
        release_url: "https://github.com/briqt/my-agent-browser/releases/tag/v2.1.0",
        notice_id: "n1",
        notice: "Upgrade to CLI",
      });
      return {
        ok: true,
        headers: new Map([["content-length", String(Buffer.byteLength(payload))]]),
        body: new ReadableStream({
          start(c) {
            c.enqueue(Buffer.from(payload));
            c.close();
          },
        }),
      };
    };

    const emitted = [];
    const t0 = 1_800_000_000_000;
    const r1 = await checkUpdate({ dir, current: "2.0.0", now: t0, fetchImpl: mockFetch, emit: (t) => emitted.push(t) });
    assert.equal(r1.status, "checked");
    assert.equal(r1.update_available, true);
    assert.equal(emitted.length, 2);
    assert.match(emitted[0], /npm i -g github:briqt\/my-agent-browser --install-links/);

    // Within 1h throttle and 24h cooldown -> cached, 0 notifications
    const r2 = await checkUpdate({ dir, current: "2.0.0", now: t0 + 60_000, fetchImpl: mockFetch, emit: (t) => emitted.push(t) });
    assert.equal(r2.status, "cached");
    assert.equal(calls, 1);
    assert.equal(emitted.length, 2);

    assert.equal(isUpdateDisabled({ env: { MY_AGENT_BROWSER_NO_UPDATE_CHECK: "1" } }), true);
    assert.equal(isUpdateDisabled({ config: { disable_update_check: true } }), true);
    assert.equal(isUpdateDisabled({ noUpdateCheck: true }), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("legacy start-mcp.js stub never crashes MCP clients and exposes only deprecation guidance", async () => {
  // CLI invocations exit 0 cleanly with deprecation message
  const cliVer = spawnSync(process.execPath, [STUB_PATH, "--version"], { encoding: "utf8" });
  assert.equal(cliVer.status, 0);
  assert.equal(cliVer.stdout.trim(), require("../package.json").version);
  assert.match(cliVer.stderr, /no longer uses MCP/);

  // MCP stdio JSON-RPC handshake + tools/list + tools/call
  const child = spawn(process.execPath, [STUB_PATH], { stdio: ["pipe", "pipe", "pipe"] });
  const responses = [];
  let buf = "";
  child.stdout.on("data", (c) => {
    buf += c.toString();
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const l of lines) if (l.trim()) responses.push(JSON.parse(l));
  });

  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } }) + "\n");
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) + "\n");
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "my_agent_browser_mcp_deprecated", arguments: {} } }) + "\n");
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "navigate_page", arguments: { pageId: 1, url: "https://example.com" } } }) + "\n");
  child.stdin.end();

  await new Promise((resolve) => child.on("close", resolve));

  const init = responses.find((r) => r.id === 1);
  assert.equal(init.result.protocolVersion, "2024-11-05");
  assert.match(init.result.instructions, /my-agent-browser/);

  const list = responses.find((r) => r.id === 2);
  assert.equal(list.result.tools.length, 1);
  assert.equal(list.result.tools[0].name, "my_agent_browser_mcp_deprecated");

  const callDep = responses.find((r) => r.id === 3);
  assert.equal(callDep.result.isError, true);
  assert.match(callDep.result.content[0].text, /Remove this legacy MCP server entry/);

  const callOld = responses.find((r) => r.id === 4);
  assert.equal(callOld.result.isError, true);
});

test("notifications suppresses older release notices when current > manifest.latest_version", () => {
  const now = 1_800_000_000_000;
  const oldState = {
    last_success_at: now,
    manifest: {
      schema_version: 1,
      latest_version: "1.5.0",
      release_url: "https://github.com/briqt/my-agent-browser/releases/tag/v1.5.0",
      notice_id: "v1.5-notice",
      notice: "Old v1.5 notice",
    },
  };
  assert.deepEqual(notifications(oldState, "2.0.0", now), []);

  const matchState = {
    last_success_at: now,
    manifest: {
      schema_version: 1,
      latest_version: "2.0.0",
      release_url: "https://github.com/briqt/my-agent-browser/releases/tag/v2.0.0",
      notice_id: "v2.0.0-cli-migration",
      notice: "Remove legacy MCP config",
    },
  };
  const tips = notifications(matchState, "2.0.0", now);
  assert.equal(tips.length, 1);
  assert.equal(tips[0].kind, "notice");
});

test("legacy start-mcp.js stub supports --no-update-check flag and Content-Length MCP framing", async () => {
  const child = spawn(process.execPath, [STUB_PATH, "--no-update-check", "--dev-config"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let outBuf = Buffer.alloc(0);
  child.stdout.on("data", (c) => {
    outBuf = Buffer.concat([outBuf, Buffer.from(c)]);
  });

  const frame = (obj) => {
    const body = JSON.stringify(obj);
    return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
  };

  child.stdin.write(frame({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } }));
  child.stdin.write(frame({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }));
  child.stdin.end();

  await new Promise((resolve) => child.on("close", resolve));
  const rawOut = outBuf.toString("utf8");
  assert.match(rawOut, /^Content-Length:\s*\d+\r\n\r\n/);
  assert.match(rawOut, /my_agent_browser_mcp_deprecated/);
});
