#!/usr/bin/env node
"use strict";

// End-to-end check that a page cannot see automation traces in its own stack traces.
//
// Boots the real start-mcp.js against a throwaway config (own port, own profile,
// headless), drives it over the MCP protocol, and inspects what a site-origin trap
// recorded. Runs twice: once with stealth on (expect a clean stack) and once with it
// off (expect the `pptr:` leak) — the control run is what proves the test can fail.
//
// Run: node skills/my-agent-browser/scripts/stealth-e2e.js

const { spawn, execFileSync } = require("child_process");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { McpSession } = require("./mcp-session");
const fs = require("fs");
const os = require("os");
const path = require("path");

const START_MCP = path.join(__dirname, "start-mcp.js");
let PORT;
async function freePort() {
  const server = require("node:net").createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
const INITIALIZE = { protocolVersion: "2024-11-05", capabilities: {},
  clientInfo: { name: "stealth-e2e", version: "1.0.0" } };

const TRAP_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Trap</title></head>
<body><h1>Trap</h1>
<script>
// Site-origin code: any pptr: frame it captures came from the driver, not from here.
window.__log = [];
Object.defineProperty(window, 'honeypot', {
  get() { window.__log.push(new Error().stack); return 1; },
  configurable: true,
});
</script>
</body></html>
`;

function jsonRpc(child) {
  let partial = "";
  const waiters = new Map();
  child.stdout.on("data", (chunk) => {
    partial += chunk.toString();
    const lines = partial.split("\n");
    partial = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id != null && waiters.has(msg.id)) {
        const { resolve } = waiters.get(msg.id);
        waiters.delete(msg.id);
        resolve(msg);
      }
    }
  });

  let id = 0;
  return {
    notify(method, params) {
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
    },
    request(method, params, timeoutMs = 90000) {
      const msgId = ++id;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters.delete(msgId);
          reject(new Error(`timeout waiting for ${method}`));
        }, timeoutMs);
        waiters.set(msgId, {
          resolve: (msg) => { clearTimeout(timer); resolve(msg); },
        });
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: msgId, method, params }) + "\n");
      });
    },
  };
}

function textOf(response) {
  const content = response.result && response.result.content;
  if (!Array.isArray(content)) return JSON.stringify(response);
  return content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
}

async function runOnce({ stealthEnabled, trapUrl, lazyStart = true, backgroundNewPages = false }) {
  PORT = await freePort();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mab-e2e-"));
  fs.writeFileSync(
    path.join(home, "config.json"),
    JSON.stringify({
      disable_update_check: true,
      browser: {
        userDataDir: path.join(home, "user-data"),
        headless: true,
        debuggingPort: PORT,
        viewport: "1280x720",
        extraArgs: ["--disable-dev-shm-usage", "--no-sandbox"],
        lazyStart,
      },
      mcp: { backgroundNewPages },
      stealth: { evaluateScript: stealthEnabled },
    }),
  );

  const child = spawn(process.execPath, [START_MCP], {
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, MY_AGENT_BROWSER_HOME: home },
  });

  try {
    const rpc = jsonRpc(child);
    await rpc.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "stealth-e2e", version: "1.0.0" },
    });
    rpc.notify("notifications/initialized", {});
    const tools = await rpc.request("tools/list", {});
    assert.equal(tools.error, undefined);
    const byName = new Map(tools.result.tools.map(tool => [tool.name, tool]));
    for (const name of ["take_snapshot", "evaluate_script", "click", "navigate_page"]) {
      assert.equal(byName.get(name).inputSchema.properties.pageId.type, "number");
      assert.ok(byName.get(name).inputSchema.required.includes("pageId"));
    }
    assert.equal(byName.get("new_page").inputSchema.properties.background.type, "boolean");
    console.log(`✔ upstream tool schemas (${byName.size} tools, numeric pageId)`);

    const opened = await rpc.request("tools/call", {
      name: "new_page",
      arguments: { url: trapUrl },
    });
    // new_page lists every tab; the one it just opened is the one marked [selected].
    const listing = textOf(opened);
    const selected = listing.match(/^(\d+):.*\[selected\]/m);
    if (!selected) throw new Error(`could not find the opened page in:\n${listing}`);
    const pageId = Number(selected[1]);
    if (process.env.E2E_DEBUG) console.log(`[debug] new_page -> pageId=${pageId}\n${textOf(opened)}`);

    // Touch the honeypot, then read back what the page recorded.
    const touched = await rpc.request("tools/call", {
      name: "evaluate_script",
      arguments: { pageId, function: "() => { void window.honeypot; return location.href; }" },
    });
    if (process.env.E2E_DEBUG) console.log(`[debug] probe -> ${textOf(touched)}`);
    const dump = await rpc.request("tools/call", {
      name: "evaluate_script",
      arguments: { pageId, function: "() => JSON.stringify(window.__log)" },
    });

    // MCP 1.12 has classic-script and local-file modes. Neither may be rewritten
    // into a callable function or bypass the upstream filesystem checks.
    const classic = await rpc.request("tools/call", {
      name: "evaluate_script",
      arguments: { pageId, format: "script", function: "window.__modeCheck = 41; window.__modeCheck + 1" },
    });
    if (classic.error || classic.result?.isError || !textOf(classic).includes("42")) {
      throw new Error("classic-script mode failed: " + textOf(classic));
    }
    const sourcePath = path.join(home, "source.js");
    fs.writeFileSync(sourcePath, "() => 43");
    const fileSource = await rpc.request("tools/call", {
      name: "evaluate_script", arguments: { pageId, sourcePath, format: "function" },
    });
    if (fileSource.error || fileSource.result?.isError || !textOf(fileSource).includes("43")) {
      throw new Error("local-file source mode failed: " + textOf(fileSource));
    }
    console.log("✔ MCP 1.12 classic-script and file-source modes");
    if (!lazyStart) await checkDirectAndRecovery(home, pageId);
    return textOf(dump);
  } finally {
    try { child.kill("SIGTERM"); } catch {}
    await new Promise((r) => setTimeout(r, 1500));
    try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
  }
}

async function checkDirectAndRecovery(home, pageId) {
  const directHome = path.join(home, "direct");
  fs.mkdirSync(directHome);
  fs.writeFileSync(path.join(directHome, "config.json"), JSON.stringify({
    disable_update_check: true, browser: { browserUrl: `http://127.0.0.1:${PORT}` },
    mcp: { backgroundNewPages: true, flags: ["--no-usage-statistics", "--no-performance-crux"] },
  }));
  const child = spawn(process.execPath, [START_MCP], { stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, MY_AGENT_BROWSER_HOME: directHome } });
  try {
    const rpc = jsonRpc(child);
    await rpc.request("initialize", INITIALIZE);
    rpc.notify("notifications/initialized", {});
    const bad = await rpc.request("tools/call", { name: "take_snapshot", arguments: { pageId: String(pageId) } });
    assert.ok(bad.error || bad.result?.isError, "string pageId must be rejected upstream");
    const good = await rpc.request("tools/call", { name: "take_snapshot", arguments: { pageId } });
    assert.ok(!good.error && !good.result?.isError, textOf(good));
    const opened = await rpc.request("tools/call", { name: "new_page", arguments: { url: "about:blank" } });
    assert.ok(!opened.error && !opened.result?.isError, textOf(opened));
    const newId = Number(textOf(opened).match(/^(\d+):.*\[selected\]/m)?.[1]);
    assert.ok(Number.isFinite(newId));
    await rpc.request("tools/call", { name: "close_page", arguments: { pageId: newId } });
    console.log("✔ direct mode: numeric pageId validation, snapshot and background new_page");
  } finally { child.kill("SIGTERM"); }

  // Inject the recovery trigger at the session boundary while using real MCP children.
  // This validates replacement handshakes/no replay, not occurrence of a stale-state bug.
  const doctor = JSON.parse(execFileSync(process.execPath, [START_MCP, "--doctor", "--json"], {
    encoding: "utf8", env: { ...process.env, MY_AGENT_BROWSER_HOME: directHome },
  }));
  assert.equal(doctor.mcpVersion, require("../version.json").tested_mcp_version);
  const children = [];
  let injected = false;
  const session = new McpSession({
    spawnChild: () => {
      const child = spawn(process.execPath, [fs.realpathSync(doctor.mcpPath), `--browserUrl=http://127.0.0.1:${PORT}`,
        "--no-usage-statistics", "--no-performance-crux"], {
        stdio: ["pipe", "pipe", "inherit"],
        env: { ...process.env, NO_PROXY: "localhost,127.0.0.1", no_proxy: "localhost,127.0.0.1" },
      });
      children.push(child);
      return child;
    },
    shouldRecover: line => {
      if (!injected && line.includes("RECOVER_AFTER_MUTATION")) { injected = true; return true; }
      return false;
    },
  });
  const stdout = new EventEmitter();
  session.on("line", line => stdout.emit("data", Buffer.from(line + "\n")));
  let recoveryError;
  session.on("error", error => { recoveryError = error; });
  const rpc = jsonRpc({ stdout, stdin: { write: line => session.write(line.trimEnd()) } });
  try {
    await rpc.request("initialize", INITIALIZE);
    rpc.notify("notifications/initialized", {});
    const failed = await rpc.request("tools/call", { name: "evaluate_script", arguments: { pageId,
      function: '() => { window.__recoveryCount = (window.__recoveryCount || 0) + 1; return "RECOVER_AFTER_MUTATION"; }' } });
    assert.equal(failed.result.isError, true);
    const count = await rpc.request("tools/call", { name: "evaluate_script", arguments: { pageId,
      function: '() => "recovery-count=" + window.__recoveryCount' } });
    assert.equal(recoveryError, undefined);
    assert.match(textOf(count), /recovery-count=1/);
    assert.equal(children.length, 2);
    console.log("✔ real MCP replacement reinitializes and never replays the completed mutation");
  } finally {
    session.end();
    for (const child of children) child.kill("SIGTERM");
  }
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mab-trap-"));
  const trapFile = path.join(tmp, "trap.html");
  fs.writeFileSync(trapFile, TRAP_HTML);
  const trapUrl = `file://${trapFile}`;

  let failures = 0;
  const check = (name, ok, detail) => {
    console.log(`${ok ? "✔" : "✖"} ${name}`);
    if (!ok) { failures++; console.log(`    ${detail}`); }
  };

  try {
    console.log("running control (stealth off, background new pages on)...");
    const off = await runOnce({ stealthEnabled: false, trapUrl, backgroundNewPages: true });
    check(
      "control: without stealth the page does see a pptr: frame",
      off.includes("pptr:"),
      `expected a pptr: frame, got: ${off.slice(0, 400)}`,
    );

    console.log("running subject (stealth on)...");
    const on = await runOnce({ stealthEnabled: true, trapUrl });
    check("stealth: no pptr: frame", !on.includes("pptr:"), on.slice(0, 400));
    check("stealth: no MCP install path", !on.includes("chrome-devtools-mcp"), on.slice(0, 400));
    check("stealth: no home directory path", !on.includes(os.homedir()), on.slice(0, 400));
    check(
      "stealth: the trap still fired (probe is actually running)",
      on.includes("Error"),
      `trap recorded nothing: ${on.slice(0, 400)}`,
    );

    // lazyStart: false takes a different stdin path (startMcpProxied instead of the
    // lazy state machine), and browserUrl mode shares that same path.
    console.log("running subject (stealth on, lazyStart off, background new pages on)...");
    const eager = await runOnce({ stealthEnabled: true, trapUrl, lazyStart: false, backgroundNewPages: true });
    check("non-lazy: no pptr: frame", !eager.includes("pptr:"), eager.slice(0, 400));
    check(
      "non-lazy: the trap still fired",
      eager.includes("Error"),
      `trap recorded nothing: ${eager.slice(0, 400)}`,
    );
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }

  console.log(failures === 0 ? "\nall e2e checks passed" : `\n${failures} e2e check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
})();
