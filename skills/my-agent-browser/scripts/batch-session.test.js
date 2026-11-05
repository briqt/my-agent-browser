"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { BatchSession, validate, definition } = require("./batch-session");
const tick = () => new Promise(setImmediate);
const fields = { fill: { uid: "string", value: "string" }, fill_form: { elements: "array" }, hover: { uid: "string" }, click: { uid: "string", dblClick: "boolean" }, press_key: { key: "string" } };
const tools = Object.entries(fields).map(([name, props]) => ({ name, inputSchema: { type: "object",
  required: ["pageId", ...Object.keys(props).filter(k => k !== "dblClick")],
  properties: { pageId: { type: "number" }, ...Object.fromEntries(Object.entries(props).map(([key, type]) => [key, { type }])) } } }));
tools.find(t => t.name === "fill_form").inputSchema.properties.elements.items = { type: "object", required: ["uid", "value"], properties: { uid: { type: "string" }, value: { type: "string" } } };
tools.push({ name: "take_snapshot", inputSchema: { type: "object", properties: { pageId: { type: "number" } } } });
const fill = value => ({ tool: "fill", arguments: { uid: "1_1", value } });
const args = () => ({ pageId: 1, actions: [fill("secret"), { tool: "click", arguments: { uid: "1_2" } }] });
function fixture(options = {}) {
  const raw = new EventEmitter(), writes = [], lines = [];
  raw.write = line => {
    const request = JSON.parse(line); writes.push(request);
    if (request.method === "tools/list" && options.autoList !== false) queueMicrotask(() => reply(request, { result: { tools: options.tools || tools } }));
  };
  raw.end = () => {};
  raw.fail = (request, message) => raw.emit("line", JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { isError: true, content: [{ type: "text", text: message }] } }));
  const session = new BatchSession(raw);
  session.on("line", line => lines.push(JSON.parse(line)));
  session.on("error", () => {});
  const reply = (request, response = { result: { content: [], structuredContent: {} } }) => raw.emit("line", JSON.stringify({ jsonrpc: "2.0", id: request.id, ...response }));
  const write = request => session.write(JSON.stringify({ jsonrpc: "2.0", ...request }));
  const run = (arguments_ = args(), id = 1) => write({ id, method: "tools/call", params: { name: "run_actions", arguments: arguments_ } });
  const calls = () => writes.filter(r => r.method === "tools/call");
  const result = id => lines.find(r => r.id === id)?.result;
  return { raw, session, writes, lines, reply, write, run, calls, result };
}
test("validates every step before dispatch and rejects cross-page, nested, oversized or nonterminal clicks", async () => {
  for (const value of [{ ...args(), pageId: "1" }, { ...args(), actions: [fill("ok"), { tool: "fill", arguments: { uid: "missing-value" } }] },
    { ...args(), actions: [{ tool: "click", arguments: { uid: "1" } }, fill("bad")] },
    { ...args(), actions: [fill("x".repeat(65536))] },
    { ...args(), actions: [ { ...fill("x"), arguments: { ...fill("x").arguments, pageId: 2 } }] },
    { ...args(), actions: [{ tool: "run_actions", arguments: {} }] },
    { ...args(), snapshotFilePath: "/tmp/file" }, { ...args(), actions: Array(11).fill(fill("x")) }]) {
    const f = fixture(); f.run(value); await tick();
    assert.equal(f.result(1).structuredContent.status, "rejected");
    assert.equal(f.writes.length, 0);
  }
  assert.doesNotThrow(() => validate(args()));
});
test("stable batch serializes actions, suppresses input echo and returns only requested final snapshot", async () => {
  const f = fixture(); f.run({ ...args(), snapshot: "final" }); await tick();
  assert.equal(f.calls().length, 1);
  assert.equal(f.calls()[0].params.arguments.includeSnapshot, false);
  f.reply(f.calls()[0]); await tick();
  assert.equal(f.calls().length, 2);
  f.reply(f.calls()[1]); await tick();
  assert.equal(f.calls()[2].params.name, "take_snapshot");
  f.reply(f.calls()[2], { result: { content: [{ type: "text", text: "Snapshot" }] } }); await tick();
  const report = f.result(1).structuredContent;
  assert.equal(report.completed, 2);
  assert.equal(report.dispatched, 2);
  assert.equal(report.snapshot.text, "Snapshot");
  assert.equal(f.result(1).isError, false);
  assert.equal(f.lines.length, 1, "internal IDs/results must never escape");
  assert.ok(!JSON.stringify(report).includes("secret"));
});
test("tool error stops subsequent actions without echoing upstream values", async () => {
  const f = fixture(); f.run(); await tick();
  f.reply(f.calls()[0], { result: { isError: true, content: [{ type: "text", text: "secret rejected" }] } }); await tick();
  const report = f.result(1).structuredContent;
  assert.deepEqual(report.steps.map(s => s.status), ["failed", "not_run"]);
  assert.equal(f.calls().length, 1);
  assert.ok(!JSON.stringify(report).includes("secret"));
});
test("successful-looking dialog, navigation, opened page and reconnect results interrupt the batch", async () => {
  for (const structuredContent of [{ dialog: { type: "alert", message: "private" } }, { navigatedToUrl: "https://example.test" }, { openedPages: [{ id: 2 }] }, { reconnected: true }]) {
    const f = fixture(); f.run({ ...args(), snapshot: "final" }); await tick();
    f.reply(f.calls()[0], { result: { content: [], structuredContent } }); await tick();
    assert.deepEqual(f.result(1).structuredContent.steps.map(s => s.status), [structuredContent.navigatedToUrl || structuredContent.openedPages ? "completed" : "interrupted", "not_run"]);
    assert.equal(f.result(1).structuredContent.snapshot.status, "skipped");
    assert.equal(f.calls().length, 1);
  }
});
test("timeout returns unknown, blocks ordinary calls until late settlement, never resumes", async () => {
  const f = fixture(); f.run({ ...args(), timeoutMs: 20, snapshot: "final" }); await tick();
  await new Promise(resolve => setTimeout(resolve, 35));
  const report = f.result(1).structuredContent;
  assert.deepEqual(report.steps.map(s => s.status), ["unknown", "not_run"]);
  assert.equal(report.settling, true);
  f.write({ id: 2, method: "tools/call", params: { name: "take_snapshot", arguments: { pageId: 1 } } });
  assert.equal(f.result(2).isError, true);
  assert.equal(f.calls().length, 1);
  f.reply(f.calls()[0]); await tick();
  f.write({ id: 3, method: "tools/call", params: { name: "take_snapshot", arguments: { pageId: 1 } } });
  assert.equal(f.calls().length, 2);
  assert.equal(f.calls()[1].id, 3);
  assert.equal(f.lines.filter(l => l.id === 1).length, 1);
});
test("cancellation stops later actions and maps the cancel ID to the active internal request", async () => {
  const f = fixture(); f.run(); await tick();
  f.write({ method: "notifications/cancelled", params: { requestId: 1 } }); await tick();
  assert.equal(f.result(1).structuredContent.reason, "cancelled");
  assert.equal(f.writes.at(-1).params.requestId, f.calls()[0].id);
  f.reply(f.calls()[0]); await tick();
  assert.equal(f.calls().length, 1);
  assert.equal(f.session.active, null);
});
test("recovery/transport exit wakes waiters without replay or leaking internal IDs", async () => {
  for (const mode of ["recover", "exit"]) {
    const f = fixture(); f.run(); await tick();
    if (mode === "recover") f.reply(f.calls()[0], { result: { isError: true, _meta: { "my-agent-browser/recovery": true } } });
    else f.raw.emit("exit", 1);
    await tick();
    assert.deepEqual(f.result(1).structuredContent.steps.map(s => s.status), ["unknown", "not_run"]);
    assert.equal(f.calls().length, 1);
    assert.equal(f.lines.length, 1);
  }
});
test("ordinary tools and batches cannot interleave; protocol replies still pass", async () => {
  const f = fixture();
  f.write({ id: 10, method: "tools/call", params: { name: "fill" } });
  f.run(); assert.equal(f.result(1).isError, true);
  f.reply(f.calls()[0]); await tick(); f.run(args(), 2); await tick();
  f.run(args(), 3); assert.equal(f.result(3).isError, true);
  f.write({ id: 99, result: { roots: [] } });
  assert.deepEqual(f.writes.at(-1).result, { roots: [] });
  f.reply(f.calls()[1]); await tick(); f.reply(f.calls()[2]); await tick();
  assert.equal(f.result(2).structuredContent.completed, 2);
});
test("final snapshot failure does not erase completed actions; snapshot output is bounded", async () => {
  for (const bad of [true, false]) {
    const f = fixture(); f.run({ pageId: 1, actions: [fill("x")], snapshot: "final" }); await tick();
    f.reply(f.calls()[0]); await tick();
    f.reply(f.calls()[1], bad ? { result: { isError: true } } : { result: { content: [{ type: "text", text: "s".repeat(15000) }] } }); await tick();
    const report = f.result(1).structuredContent;
    assert.equal(report.completed, 1);
    assert.equal(report.status, "completed");
    if (bad) assert.equal(report.snapshot.status, "failed");
    else { assert.equal(report.snapshot.text.length, 12000); assert.equal(report.snapshot.truncated, true); }
  }
});
test("discovery consumes all upstream pages and respects removed/slim/changed tool definitions", async () => {
  const f = fixture({ autoList: false }); f.write({ id: 1, method: "tools/list" });
  f.reply(f.writes[0], { result: { tools: tools.slice(0, 1), nextCursor: "next" } }); await tick();
  assert.equal(f.writes[1].params.cursor, "next");
  f.reply(f.writes[1], { result: { tools: tools.slice(1) } }); await tick();
  assert.equal(f.result(1).tools.filter(t => t.name === "run_actions").length, 1);
  assert.equal(f.result(1).tools.length, tools.length + 1);
  assert.equal(definition([{ name: "evaluate", inputSchema: {} }]), null);
  const missing = fixture({ tools: tools.filter(t => t.name !== "click") }); missing.run(); await tick();
  assert.equal(missing.result(1).structuredContent.dispatched, 0);
  const changed = structuredClone(tools); changed[0].inputSchema.required.push("newRequired");
  const drift = fixture({ tools: changed }); drift.run(); await tick();
  assert.equal(drift.result(1).structuredContent.dispatched, 0);
});
test("final file snapshot path passes upstream unchanged for workspace validation", async () => {
  const f = fixture(); f.run({ pageId: 1, actions: [fill("x")], snapshot: "final", snapshotFilePath: "/tmp/out.txt" }); await tick();
  f.reply(f.calls()[0]); await tick();
  assert.equal(f.calls()[1].params.arguments.filePath, "/tmp/out.txt");
  f.reply(f.calls()[1]); await tick();
});
test("terminal navigation is completed with a final snapshot, but fill_form navigation can be partial", async () => {
  const f = fixture(); f.run({ pageId: 1, actions: [{ tool: "click", arguments: { uid: "go" } }], snapshot: "final" }); await tick();
  f.reply(f.calls()[0], { result: { structuredContent: { navigatedToUrl: "https://example.test" }, content: [] } }); await tick();
  f.reply(f.calls()[1], { result: { content: [{ type: "text", text: "New page" }] } }); await tick();
  assert.equal(f.result(1).isError, false);
  assert.equal(f.result(1).structuredContent.completed, 1);
  const partial = fixture(); partial.run({ pageId: 1, actions: [{ tool: "fill_form", arguments: { elements: [{ uid: "a", value: "b" }] } }] }); await tick();
  partial.reply(partial.calls()[0], { result: { structuredContent: { navigatedToUrl: "https://example.test" } } }); await tick();
  assert.equal(partial.result(1).structuredContent.steps[0].status, "interrupted");
});
test("missing structured signals fail closed after the current action without issuing another", async () => {
  const f = fixture(); f.run(); await tick();
  f.reply(f.calls()[0], { result: { content: [{ type: "text", text: "Successfully filled" }] } }); await tick();
  assert.equal(f.result(1).structuredContent.reason, "missing_boundary_signals");
  assert.deepEqual(f.result(1).structuredContent.steps.map(s => s.status), ["unknown", "not_run"]);
});
test("a child process flushes completed/unknown partial results before transport exit", () => {
  const { spawnSync } = require("node:child_process");
  const script = `
    const { EventEmitter } = require('node:events');
    const { BatchSession } = require(${JSON.stringify(require.resolve("./batch-session"))});
    const raw = new EventEmitter(); let count = 0;
    raw.write = line => { const req = JSON.parse(line); queueMicrotask(() => {
      if(req.method==='tools/list') raw.emit('line',JSON.stringify({id:req.id,result:{tools:${JSON.stringify(tools)}}}));
      else if(req.method==='tools/call' && ++count===1) raw.emit('line',JSON.stringify({id:req.id,result:{structuredContent:{}}}));
      else if(req.method==='tools/call') raw.emit('exit',1);
    }); };
    const session = new BatchSession(raw);
    session.on('line', line => process.stdout.write(line+'\\n'));
    session.on('exit', code => process.stdout.write('',()=>process.exit(code)));
    session.write(JSON.stringify({id:7,method:'tools/call',params:{name:'run_actions',arguments:${JSON.stringify(args())}}}));
  `;
  const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 1, result.stderr);
  const reply = JSON.parse(result.stdout);
  assert.equal(reply.id, 7);
  assert.deepEqual(reply.result.structuredContent.steps.map(s => s.status), ["completed", "unknown"]);
});
test("repeated discovery cursors reject without actions, and native name collisions pass through after discovery", async () => {
  const f = fixture({ autoList: false }); f.run();
  f.reply(f.writes[0], { result: { tools: [], nextCursor: "same" } }); await tick();
  f.reply(f.writes[1], { result: { tools: [], nextCursor: "same" } }); await tick();
  assert.equal(f.result(1).structuredContent.dispatched, 0);
  assert.equal(f.result(1).structuredContent.status, "rejected");
  const native = fixture({ tools: [...tools, { name: "run_actions", inputSchema: {} }] });
  native.write({ id: 9, method: "tools/list" }); await tick();
  native.run();
  assert.equal(native.calls()[0].id, 1);
});
