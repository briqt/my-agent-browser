"use strict";

const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { StringDecoder } = require("node:string_decoder");
const { getHomeDir, getSocketPath, getDaemonLockPath } = require("./protocol.js");
const { isProcessAlive } = require("./chrome.js");

const DEFAULT_RPC_TIMEOUT_MS = 65_000;

function sendRawRequest(method, params = {}, { timeoutMs = DEFAULT_RPC_TIMEOUT_MS, env = process.env } = {}) {
  const socketPath = getSocketPath(env);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ path: socketPath });
    const decoder = new StringDecoder("utf8");
    let partial = "";
    let settled = false;

    const finish = (err, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch {}
      if (err) reject(err);
      else resolve(val);
    };

    const timer = setTimeout(() => {
      const timeoutErr = new Error(
        `Timed out after ${timeoutMs}ms waiting for browser daemon (${method}). ` +
        `If a mutating action was running, it may still be settling — inspect page state with 'my-agent-browser snap <pageId>' before retrying.`
      );
      timeoutErr.code = "ETIMEDOUT";
      finish(timeoutErr);
    }, timeoutMs);

    socket.once("connect", () => {
      socket.write(JSON.stringify({ method, ...params }) + "\n");
    });

    socket.on("data", (chunk) => {
      partial += decoder.write(Buffer.from(chunk));
      const idx = partial.indexOf("\n");
      if (idx !== -1) {
        try {
          finish(null, JSON.parse(partial.slice(0, idx)));
        } catch (err) {
          finish(new Error(`Invalid JSON from daemon: ${err.message}`));
        }
      }
    });

    socket.on("end", () => {
      partial += decoder.end();
      if (!settled && partial.trim()) {
        try {
          finish(null, JSON.parse(partial.trim()));
          return;
        } catch {}
      }
      if (!settled) finish(new Error("Daemon connection closed before replying"));
    });

    socket.on("error", (err) => finish(err));
  });
}

async function inspectDaemon({ env = process.env, callerOwner = "" } = {}) {
  try {
    const res = await sendRawRequest("status", { callerOwner }, { timeoutMs: 2500, env });
    if (res && res.ok) return res;
    return null;
  } catch {
    return null;
  }
}

async function isDaemonAlive(env = process.env) {
  try {
    const res = await sendRawRequest("ping", {}, { timeoutMs: 1500, env });
    return Boolean(res && res.ok);
  } catch {
    return false;
  }
}

function tryAcquireStartupLock(lockPath) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const token = randomUUID();
  const writeOwner = () => {
    const fd = fs.openSync(lockPath, "wx", 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token, createdAt: Date.now() }));
    } finally {
      fs.closeSync(fd);
    }
    return () => {
      try {
        const current = JSON.parse(fs.readFileSync(lockPath, "utf8"));
        if (current && current.token === token) fs.unlinkSync(lockPath);
      } catch {}
    };
  };
  try {
    return writeOwner();
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
  }
  // Reclaim stale lock from exited process or corrupt/truncated crash artifact (>15s old).
  try {
    let stale = false;
    try {
      const data = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      if (data && Number.isInteger(data.pid) && !isProcessAlive(data.pid)) stale = true;
    } catch {
      const st = fs.statSync(lockPath);
      if (Date.now() - st.mtimeMs > 15_000) stale = true;
    }
    if (stale) {
      fs.unlinkSync(lockPath);
      return writeOwner();
    }
  } catch {}
  return null;
}

async function ensureDaemon({
  env = process.env,
  idleTimeout,
  headless,
} = {}) {
  const existing = await sendRawRequest("ping", {}, { timeoutMs: 1500, env }).catch(() => null);
  if (existing && existing.ok && !existing.shuttingDown) return { started: false };

  const homeDir = getHomeDir(env);
  fs.mkdirSync(homeDir, { recursive: true, mode: 0o700 });
  const lockPath = getDaemonLockPath(env);
  const release = tryAcquireStartupLock(lockPath);

  if (!release) {
    const deadline = Date.now() + 16_000;
    while (Date.now() < deadline) {
      const ping = await sendRawRequest("ping", {}, { timeoutMs: 1500, env }).catch(() => null);
      if (ping && ping.ok && !ping.shuttingDown) return { started: false };
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error("Timed out waiting for another process to finish starting browser daemon");
  }

  try {
    const ping = await sendRawRequest("ping", {}, { timeoutMs: 1500, env }).catch(() => null);
    if (ping && ping.ok && !ping.shuttingDown) return { started: false };

    const daemonScript = path.join(__dirname, "daemon.js");
    const args = [];
    if (idleTimeout !== undefined) args.push("--idle-timeout", String(idleTimeout));
    if (headless === true) args.push("--headless");
    else if (headless === false) args.push("--headed");

    const child = spawn(process.execPath, [daemonScript, ...args], {
      detached: true,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env,
      windowsHide: true,
    });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        try { child.kill("SIGTERM"); } catch {}
        reject(new Error("Timed out starting browser daemon (15s)"));
      }, 15_000);

      child.once("message", (msg) => {
        clearTimeout(timer);
        if (msg && msg.ready) resolve(msg);
        else reject(new Error(msg?.error || "Daemon failed to start"));
      });
      child.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Browser daemon exited early (code ${code ?? "unknown"})`));
      });
    });

    try { child.disconnect(); } catch {}
    child.unref();
    return { started: true };
  } finally {
    release();
  }
}

async function requestDaemon(method, params = {}, options = {}) {
  const {
    env = process.env,
    timeoutMs = DEFAULT_RPC_TIMEOUT_MS,
  } = options;
  await ensureDaemon({ env });
  return sendRawRequest(method, params, { timeoutMs, env });
}

async function waitForDaemonExit(env = process.env, maxWaitMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (!(await isDaemonAlive(env))) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

module.exports = {
  DEFAULT_RPC_TIMEOUT_MS,
  sendRawRequest,
  inspectDaemon,
  isDaemonAlive,
  ensureDaemon,
  requestDaemon,
  waitForDaemonExit,
};
