"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { McpSession } = require("./mcp-session");
const { rewriteClientRequest } = require("./start-mcp");

function fixture(options = {}) {
  const children = [], lines = [], exits = [], errors = [];
  const session = new McpSession({
    spawnChild() {
      const child = new EventEmitter();
      child.stdout = new EventEmitter(); child.writes = [];
      child.stdin = { write(line) { child.writes.push(JSON.parse(line)); }, end() {} };
      child.kill = () => queueMicrotask(() => child.emit("exit", null, "SIGTERM"));
      children.push(child); return child;
    },
    shouldRecover: line => line.includes("TEST_STALE"),
    ...options,
  });
  session.on("line", line => lines.push(JSON.parse(line)));
  session.on("exit", code => exits.push(code));
  session.on("error", error => errors.push(error));
  function write(request) { session.write(JSON.stringify({ jsonrpc: "2.0", ...request })); }
  function reply(child, response) { child.stdout.emit("data", Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...response }) + "\n")); }
  write({ id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {} } });
  reply(children[0], { id: 1, result: { protocolVersion: "2025-03-26", capabilities: {} } });
  write({ method: "notifications/initialized" });
  return { session, children, lines, exits, errors, write, reply };
}

test("replacement reinitializes, ignores the old exit, and never repeats mutations", async () => {
  const f = fixture();
  f.write({ id: 2, method: "tools/call", params: { name: "click", arguments: { pageId: 1, uid: "1_1" } } });
  f.write({ id: 3, method: "tools/call", params: { name: "fill", arguments: { pageId: 1, uid: "1_2", value: "text" } } });
  f.reply(f.children[0], { id: 2, result: { isError: true, content: [{ type: "text", text: "TEST_STALE" }] } });
  await new Promise(setImmediate);
  assert.equal(f.children.length, 2);
  assert.deepEqual(f.exits, []);
  assert.deepEqual(f.errors, []);
  const replacement = f.children[1];
  assert.equal(replacement.writes[0].method, "initialize");
  assert.equal(replacement.writes[0].params.protocolVersion, "2025-03-26");
  f.write({ id: 4, method: "tools/call", params: { name: "list_pages" } });
  assert.equal(replacement.writes.length, 1, "new requests must wait for initialization");
  f.reply(replacement, { id: replacement.writes[0].id, result: { capabilities: {} } });
  assert.deepEqual(replacement.writes.map(x => x.method), ["initialize", "notifications/initialized", "tools/call"]);
  assert.equal(replacement.writes[2].id, 4);
  assert.equal(f.lines.filter(x => x.id === 2).length, 1);
  assert.equal(f.lines.filter(x => x.id === 3).length, 1);
  assert.ok(f.lines.find(x => x.id === 2).result.isError);
  assert.ok(!f.lines.some(x => typeof x.id === "string" && x.id.startsWith("my-agent-browser-initialize")));
  f.reply(replacement, { id: 4, result: { content: [] } });
  assert.equal(f.lines.at(-1).id, 4);
  f.session.end();
});

test("the shared request pipeline forwards background defaults once, including after recovery", () => {
  const config = { mcp: { backgroundNewPages: true }, stealth: { evaluateScript: false } };
  const f = fixture({ rewriteLine: line => rewriteClientRequest(line, config) });
  const call = (id, args) => ({ id, method: "tools/call", params: { name: "new_page", arguments: args } });
  f.write(call(2, { url: "about:blank" }));
  assert.deepEqual(f.children[0].writes.at(-1).params.arguments, { url: "about:blank", background: true });
  f.reply(f.children[0], { id: 2, error: { message: "TEST_STALE" } });
  const replacement = f.children[1];
  f.write(call(3, { url: "about:blank" }));
  f.write(call(4, { url: "about:blank", background: false }));
  assert.equal(replacement.writes.length, 1, "tool calls wait for initialization");
  f.reply(replacement, { id: replacement.writes[0].id, result: { capabilities: {} } });
  const calls = replacement.writes.filter(request => request.method === "tools/call");
  assert.deepEqual(calls.map(request => request.id), [3, 4], "the failed new_page is never replayed");
  assert.equal(calls[0].params.arguments.background, true);
  assert.equal(calls[1].params.arguments.background, false);
  f.session.end();
});

test("a failed replacement handshake fails queued requests and reports an error", () => {
  const f = fixture();
  f.write({ id: 2, method: "tools/call" });
  f.reply(f.children[0], { id: 2, error: { message: "TEST_STALE" } });
  f.write({ id: 3, method: "tools/list" });
  f.reply(f.children[1], { id: f.children[1].writes[0].id, error: { code: -1, message: "bad protocol" } });
  assert.match(f.errors[0].message, /initialize failed/);
  assert.ok(f.lines.find(x => x.id === 3).error);
  f.session.end();
});

test("a replacement handshake has a bounded timeout", async () => {
  const f = fixture({ initializationTimeoutMs: 10 });
  f.write({ id: 2, method: "tools/call" });
  f.reply(f.children[0], { id: 2, error: { message: "TEST_STALE" } });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.match(f.errors[0].message, /timed out/);
  f.session.end();
});

test("split UTF-8 response chunks preserve Chinese and emoji", () => {
  const f = fixture();
  const data = Buffer.from(JSON.stringify({ id: 8, result: "中文🙂" }) + "\n");
  for (const byte of data) f.children[0].stdout.emit("data", Buffer.from([byte]));
  assert.equal(f.lines.at(-1).result, "中文🙂");
  f.session.end();
});


test("replacement forwards roots replies during initialize and preserves client request ids", () => {
  const f = fixture();
  f.write({ id: 2, method: "tools/call" });
  // The server can use the same id as an unrelated client request.
  f.reply(f.children[0], { id: 2, method: "roots/list" });
  f.write({ id: 2, result: { roots: [] } });
  f.reply(f.children[0], { id: 2, error: { message: "TEST_STALE" } });
  const child = f.children[1];
  assert.ok(child, "server request must not consume the client's pending tool request");
  f.reply(child, { id: 9, method: "roots/list" });
  f.write({ id: 9, result: { roots: [] } });
  assert.equal(child.writes.at(-1).id, 9);
  assert.deepEqual(child.writes.at(-1).result, { roots: [] });
  f.reply(child, { id: child.writes[0].id, result: { capabilities: {} } });
  f.session.end();
});
