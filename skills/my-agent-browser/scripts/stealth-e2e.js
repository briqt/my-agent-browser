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

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const START_MCP = path.join(__dirname, "start-mcp.js");
const PORT = 39901;

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

async function runOnce({ stealthEnabled, trapUrl, lazyStart = true }) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mab-e2e-"));
  fs.writeFileSync(
    path.join(home, "config.json"),
    JSON.stringify({
      browser: {
        userDataDir: path.join(home, "user-data"),
        headless: true,
        debuggingPort: PORT,
        viewport: "1280x720",
        extraArgs: ["--disable-dev-shm-usage", "--no-sandbox"],
        lazyStart,
      },
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

    return textOf(dump);
  } finally {
    try { child.kill("SIGTERM"); } catch {}
    await new Promise((r) => setTimeout(r, 1500));
    try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
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
    console.log("running control (stealth off)...");
    const off = await runOnce({ stealthEnabled: false, trapUrl });
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
    console.log("running subject (stealth on, lazyStart off)...");
    const eager = await runOnce({ stealthEnabled: true, trapUrl, lazyStart: false });
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
