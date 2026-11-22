"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");

const {
  SOURCE_URL_REGEX,
  stealthConfig,
  wrapStealthFunction,
  rewriteClientLine,
  rewriteNewPageBackground,
  rewriteClientRequest,
} = require("../src/stealth.js");
const { McpSession } = require("../src/mcp-session.js");

test("SOURCE_URL_REGEX stays identical to bundled chrome-devtools-mcp 1.13.0 puppeteer", () => {
  const pkgJson = require.resolve("chrome-devtools-mcp/package.json");
  const tpFile = path.join(path.dirname(pkgJson), "out", "Default", "gen", "src", "third_party", "index.js");
  const tpSource = fs.readFileSync(tpFile, "utf8");
  const match = tpSource.match(/SOURCE_URL_REGEX\s*=\s*([^\n;]+)/);
  assert.ok(match, "Could not locate SOURCE_URL_REGEX in bundled third_party/index.js");
  assert.equal(match[1].trim(), SOURCE_URL_REGEX.toString());
  assert.ok(SOURCE_URL_REGEX.test(wrapStealthFunction("() => 1", "eval.js")));
});

test("wrapStealthFunction preserves args, return values, and sync/async errors", async () => {
  const wrapped = wrapStealthFunction("(a, b) => a + b // trailing comment", "custom.js");
  const fn = vm.runInNewContext(`(${wrapped})`, { setTimeout });
  assert.equal(await fn(20, 22), 42);

  const throwing = vm.runInNewContext(`(${wrapStealthFunction("() => { throw new Error('boom'); }")})`, { setTimeout });
  await assert.rejects(() => throwing(), /boom/);
});

test("rewriteClientRequest rewrites inline eval and unconditionally forces background: true on new_page", () => {
  const evalCall = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "evaluate_script", arguments: { pageId: 1, function: "() => document.title" } },
  });
  const rewrittenEval = JSON.parse(rewriteClientRequest(evalCall, { stealth: { evaluateScript: true, sourceUrl: "s.js" } }));
  assert.match(rewrittenEval.params.arguments.function, /sourceURL=s\.js/);

  // Classic script passes through untouched
  const classicCall = JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "evaluate_script", arguments: { pageId: 1, format: "script", function: "1 + 1" } },
  });
  assert.equal(rewriteClientLine(classicCall, stealthConfig({})), classicCall);

  // new_page ALWAYS gets background: true, even without config or when caller passed false
  const newPageCall = JSON.stringify({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "new_page", arguments: { url: "https://example.com" } },
  });
  assert.equal(JSON.parse(rewriteNewPageBackground(newPageCall)).params.arguments.background, true);

  const explicitFg = JSON.stringify({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "new_page", arguments: { url: "https://example.com", background: false } },
  });
  assert.equal(JSON.parse(rewriteClientRequest(explicitFg, {})).params.arguments.background, true);
});

function fakeChild(onInput) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.kill = () => child.emit("exit", 0, "SIGTERM");
  let buf = "";
  child.stdin.on("data", (chunk) => {
    buf += chunk.toString();
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const l of lines) if (l.trim()) onInput(JSON.parse(l), child);
  });
  return child;
}

test("McpSession replaces stale child, replays initialize, and never replays mutations", async () => {
  let spawns = 0;
  let mutations = 0;
  const session = new McpSession({
    spawnChild: () => {
      const gen = ++spawns;
      return fakeChild((msg, child) => {
        if (msg.method === "initialize") {
          child.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { gen } }) + "\n");
        } else if (msg.method === "tools/call") {
          mutations++;
          if (gen === 1) {
            child.stdout.write(
              JSON.stringify({
                jsonrpc: "2.0",
                id: msg.id,
                result: { isError: true, content: [{ type: "text", text: "No page selected" }] },
              }) + "\n"
            );
          } else {
            child.stdout.write(
              JSON.stringify({
                jsonrpc: "2.0",
                id: msg.id,
                result: { isError: false, content: [{ type: "text", text: `ok-gen-${gen}` }] },
              }) + "\n"
            );
          }
        }
      });
    },
    shouldRecover: (line) => line.includes("No page selected"),
  });

  const outputs = [];
  session.on("line", (l) => outputs.push(JSON.parse(l)));

  session.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }));
  session.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
  session.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "click", arguments: {} } }));
  await new Promise((r) => setTimeout(r, 30));

  assert.equal(spawns, 2);
  assert.equal(mutations, 1, "Failed call must not be replayed automatically");
  assert.equal(outputs.find((o) => o.id === 2).result._meta["my-agent-browser/recovery"], true);

  session.write(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "click", arguments: {} } }));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(outputs.find((o) => o.id === 3).result.content[0].text, "ok-gen-2");
  session.end();
});
