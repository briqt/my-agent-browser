#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { jsonRpc, textOf, freePort } = require("./stealth-e2e");
const HTML = `<!doctype html><meta charset="utf-8"><title>Batch form</title>
<label>First<input id="first" aria-label="First"></label>
<label>Second<input id="second" aria-label="Second"></label>
<button id="save" onclick="window.saves=(window.saves||0)+1;document.getElementById('status').textContent='Saved'">Save</button>
<button onclick="location.href='/done'">Navigate</button><p id="status">Ready</p>
<script>
window.saves=0;
first.addEventListener('input',()=>{
 const mode=new URL(location.href).searchParams.get('mode');
 if(mode==='rebuild') { const old=document.getElementById('second'); const fresh=old.cloneNode(); old.replaceWith(fresh); }
 if(mode==='dialog' && !window.prompted) { window.prompted=true; alert('Pause'); }
});
</script>`;
(async () => {
  const server = http.createServer((req, res) => { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(req.url === "/done" ? "<h1>Done</h1>" : HTML); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mab-batch-e2e-"));
  fs.writeFileSync(path.join(home, "config.json"), JSON.stringify({ disable_update_check: true,
    browser: { headless: true, debuggingPort: await freePort(), userDataDir: path.join(home, "profile"), extraArgs: ["--no-sandbox"] },
    mcp: { flags: ["--no-usage-statistics", "--no-performance-crux"] } }));
  const child = spawn(process.execPath, [path.join(__dirname, "start-mcp.js")], { stdio: ["pipe", "pipe", "inherit"], env: { ...process.env, MY_AGENT_BROWSER_HOME: home } });
  try {
    const rpc = jsonRpc(child);
    await rpc.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "batch-e2e", version: "1" } });
    rpc.notify("notifications/initialized", {});
    const list = await rpc.request("tools/list", {});
    assert.ok(list.result.tools.some(t => t.name === "run_actions"), "requires the tested MCP binary on PATH");
    const call = (name, arguments_) => rpc.request("tools/call", { name, arguments: arguments_ });
    const opened = await call("new_page", { url: base });
    const pageId = Number(textOf(opened).match(/^(\d+):.*\[selected\]/m)?.[1]);
    assert.ok(Number.isFinite(pageId));
    const evaluate = async fn => textOf(await call("evaluate_script", { pageId, function: fn }));
    const snapshot = async () => {
      const text = textOf(await call("take_snapshot", { pageId }));
      const find = (role, name) => {
        const uid = text.match(new RegExp(`uid=(\\S+) ${role} "${name}"`))?.[1];
        assert.ok(uid, `Missing ${name}: ${text}`); return uid;
      };
      return { first: find("textbox", "First"), second: find("textbox", "Second"), save: find("button", "Save"), nav: find("button", "Navigate") };
    };
    const reload = async mode => { await call("navigate_page", { pageId, url: `${base}/?mode=${mode}` }); return snapshot(); };
    let ids = await snapshot();
    const start = Date.now();
    const stable = await call("run_actions", { pageId, actions: [
      { tool: "fill", arguments: { uid: ids.first, value: "alpha" } },
      { tool: "fill", arguments: { uid: ids.second, value: "beta" } },
      { tool: "click", arguments: { uid: ids.save } },
    ], snapshot: "final" });
    assert.equal(stable.result.isError, false, textOf(stable));
    assert.equal(stable.result.structuredContent.completed, 3);
    assert.match(stable.result.structuredContent.snapshot.text, /Saved/);
    assert.match(await evaluate('() => JSON.stringify([first.value,second.value,window.saves])'), /alpha.*beta.*1/);
    console.log(`✔ stable form: 3 actions + final snapshot in one outer call (${Date.now() - start} ms; not a model latency benchmark)`);

    ids = await reload("plain");
    const rejected = await call("run_actions", { pageId, actions: [
      { tool: "fill", arguments: { uid: ids.first, value: "must-not-run" } },
      { tool: "fill", arguments: { uid: ids.second } },
    ] });
    assert.equal(rejected.result.structuredContent.dispatched, 0);
    assert.match(await evaluate('() => "first-empty=" + (first.value === "")'), /first-empty=true/);
    console.log("✔ invalid later step rejects the entire plan before any action");

    ids = await reload("rebuild");
    const stale = await call("run_actions", { pageId, actions: [
      { tool: "fill", arguments: { uid: ids.first, value: "rebuild" } },
      { tool: "fill", arguments: { uid: ids.second, value: "must-not-fill-replacement" } },
      { tool: "click", arguments: { uid: ids.save } },
    ] });
    assert.deepEqual(stale.result.structuredContent.steps.map(s => s.status), ["completed", "failed", "not_run"], textOf(stale));
    assert.match(await evaluate('() => "saves=" + window.saves + ";empty=" + (second.value === "")'), /saves=0;empty=true/);
    console.log("✔ rebuilt DOM stops stale UID action and never submits");

    ids = await reload("dialog");
    const dialog = await call("run_actions", { pageId, actions: [
      { tool: "fill_form", arguments: { elements: [{ uid: ids.first, value: "popup" }, { uid: ids.second, value: "not-filled" }] } },
      { tool: "click", arguments: { uid: ids.save } },
    ], snapshot: "final" });
    assert.equal(dialog.result.structuredContent.reason, "dialog", textOf(dialog));
    assert.deepEqual(dialog.result.structuredContent.steps.map(s => s.status), ["interrupted", "not_run"]);
    await call("handle_dialog", { pageId, action: "accept" });
    assert.match(await evaluate('() => "empty=" + (second.value === "") + ";saves=" + window.saves'), /empty=true;saves=0/);
    console.log("✔ partially filled form interrupted by dialog is not reported as completed");

    ids = await reload("plain");
    const nav = await call("run_actions", { pageId, actions: [{ tool: "click", arguments: { uid: ids.nav } }], snapshot: "final" });
    assert.equal(nav.result.structuredContent.completed, 1, textOf(nav));
    assert.equal(nav.result.isError, false, textOf(nav));
    assert.match(nav.result.structuredContent.snapshot.text, /Done/);
    console.log("✔ terminal navigation completes and returns the new page snapshot");
    console.log("all batch e2e checks passed");
  } finally {
    child.kill("SIGTERM");
    await new Promise(resolve => setTimeout(resolve, 1500));
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(home, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
