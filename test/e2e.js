#!/usr/bin/env node
"use strict";

// Real headless browser E2E test driving the `my-agent-browser` v2.0 CLI end-to-end
// against bundled `chrome-devtools-mcp@1.13.0` in an isolated temporary directory.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");
const { execFile } = require("node:child_process");

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
<title>MAB v2 E2E</title>
<h1>Trap & Form</h1>
<label>First<input id="first" aria-label="First"></label>
<label>Second<input id="second" aria-label="Second"></label>
<button id="save" onclick="window.saves=(window.saves||0)+1;document.getElementById('status').textContent='Saved'">Save</button>
<button id="reload-same" onclick="location.reload()">ReloadSameUrl</button>
<p id="status">Ready</p>
<script src="/app.js"></script>
<script>
window.__stacks = [];
Object.defineProperty(window, "honeypot", {
  get() { window.__stacks.push(new Error().stack); return "touched"; },
  configurable: true
});
window.saves = 0;
first.addEventListener("input", () => {
  const mode = new URL(location.href).searchParams.get("mode");
  if (mode === "dialog" && !window.__alerted) { window.__alerted = true; alert("Pause"); }
});
</script>`;

const APP_JS = `function computeTotal(x) {
  const doubled = x * 2;
  return doubled + 1;
}
window.computeTotal = computeTotal;
`;

(async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/app.js") {
      res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      res.end(APP_JS);
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(TEST_HTML);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  // 1. Control pass: verify trap DOES catch pptr: when stealth.evaluateScript is false
  {
    const ctrlHome = fs.mkdtempSync(path.join(os.tmpdir(), "mab-v2-ctrl-"));
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
      const opened = await cliJson(["open", `${baseUrl}/?mode=plain`], ctrlEnv);
      const pageId = opened.structuredContent.pages.find((p) => p.selected).id;
      await cliJson(["eval", String(pageId), "() => window.honeypot"], ctrlEnv);
      const stacks = (await cli(["eval", String(pageId), "() => window.__stacks", "--raw"], ctrlEnv)).stdout;
      assert.ok(stacks.includes("pptr:"), `Control failed: expected pptr: in stack when stealth=false, got: ${stacks}`);
      console.log("✔ control: site trap catches pptr: stack frame when stealth.evaluateScript=false");
    } finally {
      await cli(["stop", "--force"], ctrlEnv);
      try { fs.rmSync(ctrlHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
    }
  }

  // 2. Main v2.0 E2E pass (default stealth=true, backgroundNewPages=true, owner locks, 1.13 features)
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mab-v2-e2e-"));
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
      mcp: { backgroundNewPages: true, batchActions: true },
      stealth: { evaluateScript: true, sourceUrl: "bundle.js" },
    })
  );
  const env = { ...process.env, MY_AGENT_BROWSER_HOME: home };

  try {
    // Offline doctor & status
    const doc = await cliJson(["doctor"], env);
    assert.equal(doc.version, "2.0.0");
    assert.equal(doc.mcpVersion, "1.13.0");
    assert.equal(doc.mcpMatchesTestedVersion, true);
    assert.equal(doc.daemon, null);
    console.log("✔ offline doctor verifies bundled chrome-devtools-mcp@1.13.0 without starting daemon");

    // Tools discovery (33 default upstream + 1 run_actions = 34)
    const toolsList = await cliJson(["tools"], env);
    assert.equal(toolsList.count, 34);
    assert.ok(toolsList.tools.some((t) => t.name === "set_logpoints"));
    assert.ok(toolsList.tools.some((t) => t.name === "run_actions"));
    console.log("✔ tools lists 33 native 1.13.0 tools + run_actions");

    // Open tab locked to owner 'agent-alpha'
    const opened = await cliJson(["open", `${baseUrl}/?mode=plain`, "--owner", "agent-alpha"], env);
    const pageId = opened.structuredContent.pages.find((p) => p.selected).id;
    assert.ok(Number.isInteger(pageId));

    // Verify clean anti-detection: navigator.webdriver === false & clean stack trace
    const webdriver = (await cli(["eval", String(pageId), "() => navigator.webdriver", "--raw", "--owner", "agent-alpha"], env)).stdout.trim();
    assert.equal(webdriver, "false");
    await cliJson(["eval", String(pageId), "() => window.honeypot", "--owner", "agent-alpha"], env);
    const stacks = (await cli(["eval", String(pageId), "() => window.__stacks", "--raw", "--owner", "agent-alpha"], env)).stdout;
    assert.ok(!stacks.includes("pptr:"), `Leaked pptr: frame: ${stacks}`);
    assert.ok(!stacks.includes("chrome-devtools-mcp"), `Leaked install path: ${stacks}`);
    assert.ok(!stacks.includes(os.homedir()), `Leaked home directory: ${stacks}`);
    assert.ok(stacks.includes("bundle.js"), `Expected custom sourceUrl bundle.js: ${stacks}`);
    console.log("✔ stealth: navigator.webdriver===false and zero pptr:/username stack leak");

    // Screenshot without filePath saves to disk automatically
    const shot = await cliJson(["shot", String(pageId)], env);
    const shotFile = shot.structuredContent.savedImages[0].filePath;
    assert.ok(fs.existsSync(shotFile) && fs.statSync(shotFile).size > 100);
    fs.unlinkSync(shotFile);
    console.log("✔ screenshot saves PNG file automatically without dumping base64");

    // 1.13.0 set_logpoints + console + --clear
    await cliJson(["logpoints", String(pageId), "app.js:2 'x=', x", "--owner", "agent-alpha"], env);
    await cliJson(["eval", String(pageId), "() => window.computeTotal(20)", "--owner", "agent-alpha"], env);
    const logs = (await cli(["console", String(pageId)], env)).stdout;
    assert.match(logs, /x=.*20/);
    await cliJson(["logpoints", String(pageId), "--clear", "--owner", "agent-alpha"], env);
    console.log("✔ 1.13.0 set_logpoints logs expression to console and --clear removes logpoints");

    // Helper to parse UIDs from snap
    const getUids = async () => {
      const snapText = (await cli(["snap", String(pageId)], env)).stdout;
      const find = (role, label) => {
        const m = snapText.match(new RegExp(`uid=(\\S+) ${role} "${label}"`));
        assert.ok(m, `Missing ${role} "${label}" in:\n${snapText}`);
        return m[1];
      };
      return {
        first: find("textbox", "First"),
        second: find("textbox", "Second"),
        save: find("button", "Save"),
        reloadSame: find("button", "ReloadSameUrl"),
      };
    };

    // Bounded batch: fill + fill + click + final snapshot
    let uids = await getUids();
    const batchOk = await cliJson(
      [
        "batch",
        String(pageId),
        JSON.stringify([
          { tool: "fill", arguments: { uid: uids.first, value: "hello" } },
          { tool: "fill", arguments: { uid: uids.second, value: "world" } },
          { tool: "click", arguments: { uid: uids.save } },
        ]),
        "--snapshot",
        "final",
        "--owner",
        "agent-alpha",
      ],
      env
    );
    assert.equal(batchOk.structuredContent.completed, 3);
    assert.match(batchOk.structuredContent.snapshot.text, /Saved/);
    await cliJson(["wait-for", String(pageId), "Saved"], env);
    console.log("✔ batch executes 3 steps + final snapshot in one CLI call");

    // 1.13.0 same-URL reload boundary check (#3395)
    uids = await getUids();
    const sameUrlBatch = await cliJson(
      [
        "batch",
        String(pageId),
        JSON.stringify([{ tool: "click", arguments: { uid: uids.reloadSame } }]),
        "--snapshot",
        "final",
        "--owner",
        "agent-alpha",
      ],
      env
    );
    assert.equal(sameUrlBatch.structuredContent.completed, 1);
    assert.equal(sameUrlBatch.structuredContent.reason, "navigation");
    console.log("✔ 1.13.0 same-URL reload triggers navigation boundary cleanly");

    // Multi-agent owner protection on real Chrome tab
    const badStop = await cli(["stop", "--owner", "agent-beta"], env);
    assert.equal(badStop.status, 1);
    assert.match(badStop.stderr, /Refusing to stop browser: owner 'agent-alpha'/);

    const statusBeta = await cliJson(["status", "--owner", "agent-beta"], env);
    assert.equal(statusBeta.canStopSafely, false);
    const chromePid = statusBeta.browserPid;
    assert.ok(Number.isInteger(chromePid) && chromePid > 0);

    // Owner alpha closes its tab, then browser stops cleanly and Chrome process exits
    await cliJson(["close-page", String(pageId), "--owner", "agent-alpha"], env);
    await cliJson(["stop", "--owner", "agent-beta"], env);
    await new Promise((r) => setTimeout(r, 800));
    let chromeStillAlive = true;
    try { process.kill(chromePid, 0); } catch { chromeStillAlive = false; }
    assert.equal(chromeStillAlive, false, "Managed Chrome PID should be terminated after stop");
    console.log("✔ multi-agent owner stop-protection and clean Chrome process shutdown verified");

    console.log("\nALL v2.0 REAL-BROWSER E2E CHECKS PASSED!");
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
