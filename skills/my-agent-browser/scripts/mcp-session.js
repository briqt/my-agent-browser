"use strict";

const { EventEmitter } = require("node:events");
const { StringDecoder } = require("node:string_decoder");

/** Stable client transport while an MCP subprocess is replaced. Never replays tool calls. */
class McpSession extends EventEmitter {
  constructor({ spawnChild, rewriteLine = line => line, shouldRecover = () => false,
    log = () => {}, initializationTimeoutMs = 10000 }) {
    super();
    this.spawnChild = spawnChild;
    this.rewriteLine = rewriteLine;
    this.shouldRecover = shouldRecover;
    this.log = log;
    this.initializationTimeoutMs = initializationTimeoutMs;
    this.pending = new Map();
    this.queue = [];
    this.generation = 0;
    this.recovering = false;
    this.child = spawnChild();
    this.bind(this.child);
  }

  write(line) {
    let request;
    try { request = JSON.parse(line); } catch {}
    if (request?.method === "initialize") this.initialize = request;
    if (request?.method === "notifications/initialized") this.initialized = line;
    if (this.recovering) {
      // Responses to replacement-server requests (for example roots/list) must not
      // wait behind initialization, which may itself be waiting for this response.
      if (request?.id != null && !request.method) this.child.stdin.write(line + "\n");
      else this.queue.push(line);
      return;
    }
    this.send(line, request);
  }

  send(line, request) {
    if (!request) { try { request = JSON.parse(line); } catch {} }
    if (request?.id != null && request.method) this.pending.set(request.id, request);
    this.child.stdin.write(this.rewriteLine(line) + "\n");
  }

  bind(child) {
    const decoder = new StringDecoder("utf8");
    let partial = "";
    const consume = text => {
      partial += text;
      const lines = partial.split("\n");
      partial = lines.pop();
      for (const line of lines) if (child === this.child) this.onLine(line);
    };
    child.stdout.on("data", chunk => consume(decoder.write(Buffer.from(chunk))));
    child.stdout.on("end", () => {
      consume(decoder.end());
      if (partial && child === this.child) this.onLine(partial);
    });
    child.on("error", error => {
      if (child === this.child) { clearTimeout(this.timer); this.emit("error", error); }
    });
    child.on("exit", (code, signal) => {
      // An expected exit from a retired generation must not close the client transport.
      if (child === this.child) { clearTimeout(this.timer); this.emit("exit", code, signal); }
    });
  }

  fail(request, message) {
    if (request?.id == null) return;
    const reply = { jsonrpc: "2.0", id: request.id };
    if (request.method === "tools/call") reply.result = { isError: true, content: [{ type: "text", text: message }] };
    else reply.error = { code: -32000, message };
    this.emit("line", JSON.stringify(reply));
  }

  onLine(line) {
    let response;
    try { response = JSON.parse(line); } catch { this.emit("line", line); return; }
    // Server-initiated requests have an independent id namespace.
    if (response.method) { this.emit("line", line); return; }
    if (this.recovering && response.id === this.replayId) {
      clearTimeout(this.timer);
      if (response.error || !response.result) {
        this.failRecovery(new Error("Replacement MCP initialize failed"));
        return;
      }
      this.child.stdin.write((this.initialized || JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })) + "\n");
      this.recovering = false;
      this.log("MCP replacement initialized; previous tool calls were not replayed");
      for (const queued of this.queue.splice(0)) this.write(queued);
      return; // Internal handshake responses must not reach the client.
    }
    const request = this.pending.get(response.id);
    if (response.id != null) this.pending.delete(response.id);
    if (!this.recovering && request && this.initialize && this.shouldRecover(line)) {
      const message = "MCP state was lost. This request was not replayed. Verify the result before retrying a mutation; refresh page IDs and snapshots after recovery.";
      this.fail(request, message);
      for (const outstanding of this.pending.values()) this.fail(outstanding, message);
      this.pending.clear();
      this.recover();
      return;
    }
    this.emit("line", line);
  }

  recover() {
    this.recovering = true;
    const oldChild = this.child;
    try {
      this.child = this.spawnChild();
      this.bind(this.child);
      this.replayId = `my-agent-browser-initialize-${++this.generation}`;
      this.timer = setTimeout(() => this.failRecovery(new Error("Replacement MCP initialize timed out")), this.initializationTimeoutMs);
      this.timer.unref?.();
      this.child.stdin.write(JSON.stringify({ ...this.initialize, id: this.replayId }) + "\n");
    } catch (error) {
      this.failRecovery(error);
    } finally {
      try { oldChild.kill("SIGTERM"); } catch {}
    }
  }

  failRecovery(error) {
    clearTimeout(this.timer);
    for (const line of this.queue.splice(0)) {
      try { this.fail(JSON.parse(line), error.message); } catch {}
    }
    this.emit("error", error);
  }

  end() { clearTimeout(this.timer); this.child.stdin.end(); }
}

module.exports = { McpSession };
