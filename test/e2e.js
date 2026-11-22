#!/usr/bin/env node
"use strict";

// Real headless browser E2E test against bundled chrome-devtools-mcp@1.13.0 in an isolated temp dir.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");
const { execFile } = require("node:child_process");
const pkg = require("../package.json");

const CLI_PATH = process.env.MAB_CLI_PATH
  ? path.resolve(process.env.MAB_CLI_PATH)
  : path.resolve(__dirname, "..", "src", "cli.js");

async function freePort() {
  const srv = net.createServer();
  await new Promise((resolve, reject) => {
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", resolve);
  });
  const port = srv.address().port;
  await new Promise((resolve) => srv.close(resolve));
  return port;
}

function cli(args, env, timeout = 60_000) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CLI_PATH, "--no-update-check", ...args],
      { env, encoding: "utf8", timeout, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          status: error ? (typeof error.code === "number" ? error.code : 1) : 0,
          stdout: stdout || "",
          stderr: stderr || "",
        });
      }
    );
  });
}

async function cliJson(args, env) {
  const res = await cli([...args, "--json"], env);
  assert.equal(res.status, 0, `CLI failed (${args.join(" ")}):\nstdout=${res.stdout}\nstderr=${res.stderr}`);
  return JSON.parse(res.stdout);
}

const TEST_HTML = `<!doctype html>
<meta charset="utf-8">
<title>MAB v2.1 E2E</title>
<h1>Trap & Form</h1>
<label>First<input id="first" aria-label="First"></label>
<label>Second<input id="second" aria-label="Second"></label>
<button id="save" onclick="window.saves=(window.saves||0)+1;document.getElementById('status').textContent='Saved'">Save</button>
<p id="status">Ready</p>
<p id="mock-data">Original</p>
<script src="/app.js"></script>
<script>
window.__stacks = [];
Object.defineProperty(window, "honeypot", {
  get() { window.__stacks.push(new Error().stack); return "touched"; },
  configurable: true,
});
window.saves = 0;
</script>`;

const APP_JS = `function computeTotal(x) {
  const doubled = x * 2;
  return doubled + 1;
}
window.computeTotal = computeTotal;
fetch("/api/info").then(r => r.text()).then(t => {
  const el = document.getElementById("mock-data");
  if (el) el.textContent = t;
}).catch(() => {});
`;

(async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/app.js") {
      res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      res.end(APP_JS);
      return;
    }
    if (req.url === "/api/info") {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("REAL_API");
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(TEST_HTML);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  // 1. Control pass: verify trap catches pptr: when stealth.evaluateScript is false
  {
    const ctrlHome = fs.mkdtempSync(path.join(os.tmpdir(), "mab-v21-ctrl-"));
    const ctrlPort = await freePort();
    fs.writeFileSync(
      path.join(ctrlHome, "config.json"),
      JSON.stringify({
        disable_update_check: true,
        browser: {
          userDataDir: path.join(ctrlHome, "profile"),
          headless: true,
          debuggingPort: ctrlPort,
          extraArgs: ["--disable-dev-shm-usage", "--no-sandbox"],
          idleTimeout: "5m",
        },
        stealth: { evaluateScript: false },
      })
    );
    const ctrlEnv = { ...process.env, MY_AGENT_BROWSER_HOME: ctrlHome };
    try {
      const opened = await cli(["open", `${baseUrl}/`, "--raw"], ctrlEnv);
      assert.equal(opened.status, 0, opened.stderr);
      const pageId = opened.stdout.trim();
      assert.match(pageId, /^\d+$/);
      await cliJson(["eval", pageId, "() => window.honeypot"], ctrlEnv);
      const stacks = (await cli(["eval", pageId, "() => window.__stacks", "--raw"], ctrlEnv)).stdout;
      assert.ok(stacks.includes("pptr:"), `Control failed: expected pptr: when stealth=false, got: ${stacks}`);
      console.log("✔ control: site trap catches pptr: stack frame when stealth.evaluateScript=false");
    } finally {
      await cli(["stop", "--force"], ctrlEnv);
      try { fs.rmSync(ctrlHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
    }
  }

  // 2. Main v2.1 E2E pass (slim config, 50 default tools, open --raw, mock_network, logpoints, owner locks)
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mab-v21-e2e-"));
  const port = await freePort();
  fs.writeFileSync(
    path.join(home, "config.json"),
    JSON.stringify({
      disable_update_check: true,
      browser: {
        userDataDir: path.join(home, "profile"),
        headless: true,
        debuggingPort: port,
        extraArgs: ["--disable-dev-shm-usage", "--no-sandbox"],
        idleTimeout: "10m",
      },
      stealth: { evaluateScript: true, sourceUrl: "bundle.js" },
    })
  );
  const env = { ...process.env, MY_AGENT_BROWSER_HOME: home };

  try {
    // Offline doctor
    const doc = await cliJson(["doctor"], env);
    assert.equal(doc.version, pkg.version);
    assert.equal(doc.mcpVersion, pkg.dependencies["chrome-devtools-mcp"]);
    assert.equal(doc.mcpMatchesTestedVersion, true);
    assert.equal(doc.daemon, null);
    console.log("✔ offline doctor verifies bundled chrome-devtools-mcp@1.13.0 without starting daemon");

    // Tools discovery: all 50 upstream tools enabled by default
    const toolsList = await cliJson(["tools"], env);
    assert.equal(toolsList.count, 50);
    for (const expected of ["set_logpoints", "mock_network", "remove_network_mock", "configure_webauthn", "click_at", "get_heapsnapshot_summary"]) {
      assert.ok(toolsList.tools.some((t) => t.name === expected), `Missing default tool: ${expected}`);
    }
    console.log("✔ tools lists all 50 native 1.13.0 tools out of the box (zero config)");

    // Open tab locked to owner 'agent-alpha' via --raw
    const openRaw = await cli(["open", `${baseUrl}/`, "--owner", "agent-alpha", "--raw"], env);
    assert.equal(openRaw.status, 0, openRaw.stderr);
    const pageId = openRaw.stdout.trim();
    assert.match(pageId, /^\d+$/);

    // Stealth check
    const webdriver = (await cli(["eval", pageId, "() => navigator.webdriver", "--raw", "--owner", "agent-alpha"], env)).stdout.trim();
    assert.equal(webdriver, "false");
    await cliJson(["eval", pageId, "() => window.honeypot", "--owner", "agent-alpha"], env);
    const stacks = (await cli(["eval", pageId, "() => window.__stacks", "--raw", "--owner", "agent-alpha"], env)).stdout;
    assert.ok(!stacks.includes("pptr:"), `Leaked pptr: frame: ${stacks}`);
    assert.ok(!stacks.includes("chrome-devtools-mcp"), `Leaked install path: ${stacks}`);
    assert.ok(!stacks.includes(os.homedir()), `Leaked home directory: ${stacks}`);
    assert.ok(stacks.includes("bundle.js"), `Expected custom sourceUrl bundle.js: ${stacks}`);
    console.log("✔ stealth: navigator.webdriver===false and zero pptr:/username stack leak");

    // Screenshot --raw saves PNG file automatically and returns bare path
    const shotRes = await cli(["shot", pageId, "--raw"], env);
    assert.equal(shotRes.status, 0, shotRes.stderr);
    const shotFile = shotRes.stdout.trim();
    assert.ok(fs.existsSync(shotFile) && fs.statSync(shotFile).size > 100);
    fs.unlinkSync(shotFile);
    console.log("✔ shot --raw saves PNG automatically and outputs bare path");

    // Zero-config mock_network test
    const mockFile = path.join(home, "mock-info.txt");
    fs.writeFileSync(mockFile, "MOCKED_RESPONSE");
    await cliJson(["mock_network", pageId, "--route", `${baseUrl}/api/info`, "--body", mockFile, "--owner", "agent-alpha"], env);
    await cliJson(["reload", pageId, "--owner", "agent-alpha"], env);
    await cliJson(["wait-for", pageId, "MOCKED_RESPONSE"], env);
    await cliJson(["remove_network_mock", pageId, "--owner", "agent-alpha"], env);
    console.log("✔ mock_network works out of the box with zero mcp.flags config");

    // 1.13.0 set_logpoints + console + --clear
    await cliJson(["logpoints", pageId, "app.js:2 'x=', x", "--owner", "agent-alpha"], env);
    await cliJson(["eval", pageId, "() => window.computeTotal(20)", "--owner", "agent-alpha"], env);
    const logs = (await cli(["console", pageId], env)).stdout;
    assert.match(logs, /x=.*20/);
    await cliJson(["logpoints", pageId, "--clear", "--owner", "agent-alpha"], env);
    console.log("✔ set_logpoints logs expression to console and --clear removes logpoints");

    // fill-form + click + wait-for via standard CLI steps
    const snapText = (await cli(["snap", pageId], env)).stdout;
    const findUid = (role, label) => {
      const m = snapText.match(new RegExp(`uid=(\\S+) ${role} "${label}"`));
      assert.ok(m, `Missing ${role} "${label}" in:\n${snapText}`);
      return m[1];
    };
    await cliJson(["fill-form", pageId, `${findUid("textbox", "First")}=hello`, `${findUid("textbox", "Second")}=world`, "--owner", "agent-alpha"], env);
    await cliJson(["click", pageId, findUid("button", "Save"), "--owner", "agent-alpha"], env);
    await cliJson(["wait-for", pageId, "Saved"], env);
    console.log("✔ fill-form + click + wait-for workflow verified");

    // Multi-agent owner protection on real Chrome tab
    const badStop = await cli(["stop", "--owner", "agent-beta"], env);
    assert.equal(badStop.status, 1);
    assert.match(badStop.stderr, /Refusing to stop browser: owner 'agent-alpha'/);

    const statusBeta = await cliJson(["status", "--owner", "agent-beta"], env);
    assert.equal(statusBeta.canStopSafely, false);
    const chromePid = statusBeta.browserPid;
    assert.ok(Number.isInteger(chromePid) && chromePid > 0);

    // Owner alpha closes its tab, then browser stops cleanly and Chrome process exits
    await cliJson(["close-page", pageId, "--owner", "agent-alpha"], env);
    await cliJson(["stop", "--owner", "agent-beta"], env);
    await new Promise((r) => setTimeout(r, 800));
    let chromeStillAlive = true;
    try { process.kill(chromePid, 0); } catch { chromeStillAlive = false; }
    assert.equal(chromeStillAlive, false, "Managed Chrome PID should be terminated after stop");
    console.log("✔ multi-agent owner stop-protection and clean Chrome process shutdown verified");

    console.log(`\nALL v${pkg.version} REAL-BROWSER E2E CHECKS PASSED!`);
  } finally {
    await cli(["stop", "--force"], env);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
