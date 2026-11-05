"use strict";
const { EventEmitter } = require("node:events");
const { randomUUID } = require("node:crypto");

const NAME = "run_actions";
const LIMIT = 10;
const TERMINAL = new Set(["click", "press_key"]);
const FIELDS = {
  fill: { uid: "string", value: "string" },
  fill_form: { elements: "elements" },
  hover: { uid: "string" },
  click: { uid: "string", dblClick: "boolean?" },
  press_key: { key: "string" },
};
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
function checkKeys(value, allowed, where) {
  if (!object(value)) throw new Error(`${where} must be an object`);
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error(`${where} has an unsupported field`);
}
function validate(request) {
  checkKeys(request, ["pageId", "actions", "snapshot", "snapshotFilePath", "timeoutMs"], "arguments");
  if (!Number.isSafeInteger(request.pageId) || request.pageId < 0) throw new Error("pageId must be a nonnegative integer");
  if (!Array.isArray(request.actions) || !request.actions.length || request.actions.length > LIMIT) throw new Error(`actions must contain 1–${LIMIT} steps`);
  if (request.snapshot !== undefined && !["none", "final"].includes(request.snapshot)) throw new Error("snapshot must be none or final");
  if (request.snapshotFilePath !== undefined && (typeof request.snapshotFilePath !== "string" || !request.snapshotFilePath || request.snapshot !== "final")) throw new Error("snapshotFilePath requires snapshot: final and a nonempty path");
  if (request.timeoutMs !== undefined && (!Number.isInteger(request.timeoutMs) || request.timeoutMs < 1 || request.timeoutMs > 120000)) throw new Error("timeoutMs must be 1–120000");
  if (Buffer.byteLength(JSON.stringify(request)) > 65536) throw new Error("batch arguments exceed 64 KiB");
  request.actions.forEach((action, i) => {
    checkKeys(action, ["tool", "arguments"], `action ${i}`);
    if (!Object.hasOwn(FIELDS, action.tool)) throw new Error(`action ${i} uses an unsupported tool`);
    if (TERMINAL.has(action.tool) && i !== request.actions.length - 1) throw new Error(`action ${i}: click/press_key must be the last step`);
    const fields = FIELDS[action.tool];
    checkKeys(action.arguments, Object.keys(fields), `action ${i} arguments`);
    for (const [key, spec] of Object.entries(fields)) {
      const value = action.arguments[key];
      if (spec.endsWith("?") && value === undefined) continue;
      if (spec === "elements") {
        if (!Array.isArray(value) || !value.length || value.length > 50) throw new Error(`action ${i}: elements must contain 1–50 entries`);
        for (const item of value) {
          checkKeys(item, ["uid", "value"], `action ${i} element`);
          if (typeof item.uid !== "string" || !item.uid || typeof item.value !== "string") throw new Error(`action ${i}: each element needs uid and value strings`);
        }
      } else if (typeof value !== spec.replace("?", "") || (["uid", "key"].includes(key) && !value)) {
        throw new Error(`action ${i}: invalid ${key} type or empty identifier`);
      }
    }
  });
  return request;
}
function compatible(tool) {
  const fields = FIELDS[tool.name];
  const schema = tool.inputSchema;
  if (!fields || schema?.type !== "object" || schema.properties?.pageId?.type !== "number" || !schema.required?.includes("pageId")) return false;
  const known = ["pageId", "includeSnapshot", ...Object.keys(fields)];
  if (schema.required.some(key => !known.includes(key))) return false;
  for (const [key, type] of Object.entries(fields)) {
    if (schema.properties[key]?.type !== (type === "elements" ? "array" : type.replace("?", ""))) return false;
  }
  if (tool.name === "fill_form") {
    const item = schema.properties.elements.items;
    if (item?.type !== "object" || item.properties?.uid?.type !== "string" || item.properties?.value?.type !== "string" ||
        item.required?.some(key => !["uid", "value"].includes(key))) return false;
  }
  return true;
}
function definition(available) {
  const names = available.filter(compatible).map(t => t.name);
  if (!names.length) return null;
  return { name: NAME,
    description: "Run up to 10 known actions sequentially on ONE observed, stable page. Use fill/fill_form/hover; click or press_key only LAST. Stops on first error, dialog, navigation or new page. No replay/rollback. Timeout/cancellation may leave the current action running (unknown). Same-session tool calls are blocked until it settles. Step summaries omit input values; snapshots may contain them. Request an optional final snapshot; use snapshotFilePath for heavy pages. Observe again after any boundary; do not batch uncertain steps.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    inputSchema: { type: "object", required: ["pageId", "actions"], additionalProperties: false,
      properties: {
        pageId: { type: "integer", minimum: 0 },
        actions: { type: "array", minItems: 1, maxItems: LIMIT, items: { oneOf: names.map(name => ({
          type: "object", required: ["tool", "arguments"], additionalProperties: false,
          properties: { tool: { const: name }, arguments: { type: "object", additionalProperties: false,
            required: Object.entries(FIELDS[name]).filter(([, t]) => !t.endsWith("?")).map(([key]) => key),
            properties: Object.fromEntries(Object.entries(FIELDS[name]).map(([key, type]) => [key, type === "elements"
              ? { type: "array", minItems: 1, maxItems: 50, items: { type: "object", required: ["uid", "value"], additionalProperties: false, properties: { uid: { type: "string", minLength: 1 }, value: { type: "string" } } } }
              : { type: type.replace("?", ""), ...(["uid", "key"].includes(key) ? { minLength: 1 } : {}) }])) } },
        })) } },
        snapshot: { type: "string", enum: ["none", "final"], default: "none" },
        snapshotFilePath: { type: "string", minLength: 1 },
        timeoutMs: { type: "integer", minimum: 1, maximum: 120000, default: 30000 },
      } } };
}
function boundary(response) {
  const s = response.result?.structuredContent;
  if (s?.reconnected) return "reconnected";
  if (s?.dialog) return "dialog";
  if (s?.navigatedToUrl) return "navigation";
  if (s?.openedPages?.length) return "new_page";
  return null;
}
function uncertain(response) {
  return response.result?._meta?.["my-agent-browser/recovery"] === true || response.wrapperUncertain;
}

/** Add a bounded compound tool without changing upstream transport or tool semantics. */
class BatchSession extends EventEmitter {
  constructor(raw) {
    super();
    this.raw = raw;
    this.prefix = `mab-${randomUUID()}-`;
    this.serial = 0;
    this.internal = new Map();
    this.externalTools = new Set();
    raw.on("line", line => this.onLine(line));
    // Let pending promises produce their partial reports before the launcher exits.
    raw.on("error", error => { this.abortTransport(); setImmediate(() => this.emit("error", error)); });
    raw.on("exit", (code, signal) => { this.abortTransport(); setImmediate(() => this.emit("exit", code, signal)); });
  }
  get recovering() { return this.raw.recovering; }
  fail(request, message) { this.raw.fail(request, message); }
  end() { this.abortTransport(); this.raw.end(); }
  reply(request, value, isError = false) {
    this.emit("line", JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {
      isError, content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value,
    } }));
  }
  write(line) {
    let request;
    try { request = JSON.parse(line); } catch { this.raw.write(line); return; }
    if (!request || typeof request !== "object") { this.raw.write(line); return; }
    // Server-initiated replies must pass even during a batch/initialize handshake.
    if (!request.method) { this.raw.write(line); return; }
    if (typeof request.id === "string" && request.id.startsWith(this.prefix)) { this.fail(request, "Reserved wrapper request ID"); return; }
    if (request.method === "notifications/cancelled" && this.active?.request.id === request.params?.requestId) {
      this.stop(this.active, "cancelled"); return;
    }
    if (request.method === "tools/list" && request.id != null) {
      if (this.internal.size >= 8) { this.fail(request, "Too many pending discovery requests; wait for upstream responses."); return; }
      void this.list(request); return;
    }
    if (request.method === "tools/call") {
      if (request.id == null) return; // MCP tool calls must be requests, never fire-and-forget.
      if (this.active) { this.fail(request, "A batch is active or its timed-out action is still settling. Inspect its result; wait for settlement or restart this MCP session before using tools. No action was dispatched for this request."); return; }
      if (request.params?.name === NAME && !this.nativeBatch) { void this.run(request); return; }
      this.externalTools.add(request.id);
    }
    this.raw.write(line);
  }
  onLine(line) {
    let response;
    try { response = JSON.parse(line); } catch { this.emit("line", line); return; }
    if (response.method) { this.emit("line", line); return; }
    const pending = this.internal.get(response.id);
    if (pending) {
      this.internal.delete(response.id);
      // Preserve crash handling in managed lazy mode even though internal IDs stay private.
      this.emit("internalResponse", line);
      pending.resolve(response);
      return;
    }
    this.externalTools.delete(response.id);
    this.emit("line", line);
  }
  call(method, params) {
    const id = this.prefix + ++this.serial;
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    this.internal.set(id, { resolve });
    this.raw.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return { id, promise };
  }
  async discover(context) {
    const tools = [], seen = new Set();
    let cursor;
    for (let page = 0; page < 20; page++) {
      const response = await this.awaitCall(context, "tools/list", cursor ? { cursor } : {});
      if (!response || response.error || !Array.isArray(response.result?.tools)) throw new Error("Upstream tool discovery failed");
      tools.push(...response.result.tools);
      if (tools.length > 1000) throw new Error("Upstream tool list exceeds limit");
      cursor = response.result.nextCursor;
      if (!cursor) return tools;
      if (seen.has(cursor)) throw new Error("Upstream tool-list cursor repeated");
      seen.add(cursor);
    }
    throw new Error("Upstream tool-list pagination exceeds limit");
  }
  async list(request) {
    const ctx = { stopped: false };
    ctx.stopPromise = new Promise(resolve => { ctx.resolveStop = resolve; });
    const timer = setTimeout(() => { ctx.stopped = true; ctx.resolveStop(null); }, 10000);
    try {
      const tools = await this.discover(ctx);
      this.nativeBatch = tools.some(t => t.name === NAME);
      const extra = definition(tools);
      if (extra && !tools.some(t => t.name === NAME)) tools.push(extra);
      this.emit("line", JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { tools } }));
    } catch { this.fail(request, "Could not discover the upstream tool list. Retry after MCP recovery."); }
    finally { clearTimeout(timer); }
  }
  async awaitCall(ctx, method, params) {
    if (ctx.stopped) return null;
    const pending = this.call(method, params);
    ctx.pending = pending;
    const response = await Promise.race([pending.promise, ctx.stopPromise]);
    if (response !== null) ctx.pending = null;
    return response;
  }
  stop(ctx, reason) {
    if (ctx.stopped) return;
    ctx.stopped = true;
    ctx.reason = reason;
    if (ctx.pending) this.raw.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: ctx.pending.id, reason: "Compound action stopped; do not replay" } }));
    ctx.resolveStop(null);
  }
  abortTransport() {
    for (const pending of this.internal.values()) pending.resolve({ wrapperUncertain: true });
    this.internal.clear();
    this.externalTools.clear();
  }
  async run(request) {
    if (this.externalTools.size || this.raw.recovering) { this.fail(request, "Other tools are still running or MCP is recovering. No batch action was dispatched; observe again before retrying."); return; }
    let args;
    try { args = validate(request.params.arguments); }
    catch (error) { this.reply(request, { status: "rejected", reason: error.message, dispatched: 0 }, true); return; }
    const ctx = { request, stopped: false, phase: "preflight" };
    ctx.stopPromise = new Promise(resolve => { ctx.resolveStop = resolve; });
    this.active = ctx;
    const timer = setTimeout(() => this.stop(ctx, "timeout"), args.timeoutMs ?? 30000);
    const report = { status: "completed", pageId: args.pageId, completed: 0, dispatched: 0,
      steps: args.actions.map((a, index) => ({ index, tool: a.tool, status: "not_run" })), snapshot: { status: "not_requested" } };
    try {
      const tools = await this.discover(ctx);
      const available = new Map(tools.filter(compatible).map(tool => [tool.name, tool]));
      if (tools.some(t => t.name === NAME)) { this.nativeBatch = true; throw new Error("Upstream defines run_actions; rediscover tools before using its native interface"); }
      if (args.actions.some(action => !available.has(action.tool))) throw new Error("A requested action is unavailable in the current upstream tool set");
      if (args.snapshot === "final" && !tools.some(t => t.name === "take_snapshot" && t.inputSchema?.properties?.pageId?.type === "number")) throw new Error("Final snapshot is unavailable in the current upstream tool set");
      for (let i = 0; i < args.actions.length; i++) {
        if (ctx.stopped) break;
        const action = args.actions[i], step = report.steps[i];
        ctx.phase = "action";
        report.dispatched++;
        const response = await this.awaitCall(ctx, "tools/call", { name: action.tool, arguments: { ...action.arguments, pageId: args.pageId, includeSnapshot: false } });
        if (!response || uncertain(response)) {
          step.status = "unknown"; report.status = "stopped"; report.reason = ctx.reason || "recovery_or_disconnect"; break;
        }
        if (response.error || response.result?.isError || !response.result) {
          step.status = "failed"; report.status = "stopped"; report.reason = "tool_error";
          // Raw upstream diagnostics can echo typed credentials; return a fixed instruction.
          step.message = "Upstream action failed; partial effects are possible. Inspect the page before retrying.";
          break;
        }
        if (!object(response.result.structuredContent)) {
          step.status = "unknown"; report.status = "stopped"; report.reason = "missing_boundary_signals";
          break;
        }
        const changed = boundary(response);
        if (changed) {
          const completedBoundary = action.tool !== "fill_form" && (changed === "navigation" || changed === "new_page");
          step.status = completedBoundary ? "completed" : "interrupted";
          if (completedBoundary) report.completed++;
          report.status = completedBoundary && i === args.actions.length - 1 ? "completed" : "stopped";
          report.reason = changed;
          step.message = completedBoundary ? "Action completed at a page boundary; remaining input steps were not run."
            : "Action may be partially complete. Observe before continuing.";
          break;
        }
        step.status = "completed"; report.completed++;
      }
      if (args.snapshot === "final") {
        report.snapshot = { status: "skipped" };
        if (!ctx.stopped && report.status === "completed") {
          ctx.phase = "snapshot";
          const response = await this.awaitCall(ctx, "tools/call", { name: "take_snapshot", arguments: {
            pageId: args.pageId, ...(args.snapshotFilePath ? { filePath: args.snapshotFilePath } : {}),
          } });
          if (!response || uncertain(response)) report.snapshot = { status: "unknown" };
          else if (response.error || response.result?.isError || !response.result) report.snapshot = { status: "failed" };
          else if (boundary(response)) report.snapshot = { status: "interrupted", reason: boundary(response) };
          else {
            const text = (response.result.content || []).filter(c => c.type === "text").map(c => c.text).join("\n");
            report.snapshot = { status: "completed", text: text.slice(0, 12000), truncated: text.length > 12000 };
          }
        }
      }
    } catch (error) {
      report.status = ctx.stopped ? "stopped" : "rejected";
      report.reason = ctx.reason || error.message;
    } finally {
      clearTimeout(timer);
      if (ctx.stopped) { report.status = "stopped"; report.reason = ctx.reason; }
      report.settling = Boolean(ctx.pending);
      this.reply(request, report, report.status !== "completed" || ["failed", "unknown", "interrupted"].includes(report.snapshot.status));
      // Timeout is not cancellation of browser effects: hold the lease until the late
      // response, recovery, disconnect or explicit session restart settles the request.
      if (ctx.pending) await ctx.pending.promise;
      if (this.active === ctx) this.active = null;
    }
  }
}
module.exports = { BatchSession, validate, definition, compatible, boundary };
