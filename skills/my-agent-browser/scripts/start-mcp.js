#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const { execFileSync, spawn } = require("child_process");

const SKILL_NAME = "my-agent-browser";
const configDir =
  process.env.MY_AGENT_BROWSER_HOME ||
  path.join(os.homedir(), ".config", "agent-skills", SKILL_NAME);
const configFile = path.join(configDir, "config.json");
const lockFile = path.join(configDir, "browser.lock");

const DEFAULT_PORT = 39813;

function expandHome(p) {
  if (p.startsWith("~/") || p === "~") {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

function loadConfig() {
  // Search: skill-local dev override, then standard data dir
  const skillDir = path.resolve(__dirname, "..");
  const devConfig = path.join(skillDir, ".config.json");
  const candidates = [devConfig, configFile];

  for (const f of candidates) {
    if (fs.existsSync(f)) {
      try {
        const cfg = JSON.parse(fs.readFileSync(f, "utf-8"));
        process.stderr.write(`[my-agent-browser] config loaded: ${f}\n`);
        return cfg;
      } catch (e) {
        process.stderr.write(`[my-agent-browser] failed to parse ${f}: ${e.message}\n`);
        process.exit(1);
      }
    }
  }

  process.stderr.write(
    `[my-agent-browser] config not found. Searched:\n` +
    candidates.map((c) => `  - ${c}`).join("\n") + "\n" +
    `Fix:\n  mkdir -p "${configDir}" && cp "${path.join(skillDir, "config.example.json")}" "${configFile}"\n` +
    `Then edit ${configFile} to set your preferences.\nUsing defaults for now.\n`
  );
  return {};
}

// --- Lock file management ---

function readLock() {
  try {
    return JSON.parse(fs.readFileSync(lockFile, "utf-8"));
  } catch {
    return null;
  }
}

function writeLock(data) {
  fs.mkdirSync(configDir, { recursive: true });
  const tmp = lockFile + ".tmp." + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, lockFile);
}

function deleteLock() {
  try { fs.unlinkSync(lockFile); } catch {}
}

function isProcessAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function probePort(port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const opts = {
      hostname: "127.0.0.1",
      port,
      path: "/json/version",
      timeout: timeoutMs,
    };
    const req = http.get(opts, (res) => {
      if (res.statusCode !== 200) { res.resume(); resolve(false); return; }
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try { const j = JSON.parse(body); resolve(!!j.Browser); }
        catch { resolve(false); }
      });
    });
    req.on("error", () => resolve(false));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(false); });
  });
}

async function waitForPort(port, maxWaitMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (await probePort(port, 1000)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

// --- Chrome launcher ---

function findChrome() {
  const names = process.platform === "win32"
    ? ["chrome.exe", "google-chrome.exe"]
    : process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "google-chrome", "chromium"]
      : ["google-chrome", "google-chrome-stable", "chromium-browser", "chromium"];

  for (const name of names) {
    try {
      const cmd = process.platform === "win32" ? "where" : "which";
      const result = execFileSync(cmd, [name], {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      if (result) return result.split(/\r?\n/)[0];
    } catch {}
  }

  if (process.platform === "darwin") {
    const macPath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    if (fs.existsSync(macPath)) return macPath;
  }

  return null;
}

function launchChrome(config, port) {
  const b = config.browser || {};
  const userDataDir = b.userDataDir
    ? expandHome(b.userDataDir)
    : path.join(configDir, "user-data");

  const chromePath = findChrome();
  if (!chromePath) {
    process.stderr.write("[my-agent-browser] Chrome not found. Install Chrome or set executablePath in config.\n");
    process.exit(1);
  }

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-crash-restore-bubble",
  ];

  if (b.headless) args.push("--headless=new");
  if (b.proxy) args.push(`--proxy-server=${b.proxy}`);
  if (b.viewport) {
    const [w, h] = b.viewport.split("x");
    args.push(`--window-size=${w},${h}`);
  }
  for (const arg of b.extraArgs || []) args.push(arg);

  const child = spawn(chromePath, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return child.pid;
}

// --- MCP server launcher ---

function findMcpBin() {
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    const result = execFileSync(cmd, ["chrome-devtools-mcp"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (result) return result.split(/\r?\n/)[0];
  } catch {}
  return null;
}

function buildMcpArgs(config, port) {
  const m = config.mcp || {};
  const args = [`--browserUrl=http://127.0.0.1:${port}`];

  for (const f of m.features || []) args.push(f);
  for (const f of m.flags || []) args.push(f);

  return args;
}

function startMcp(args, { pipe = false } = {}) {
  const stdio = pipe ? ["pipe", "pipe", "inherit"] : "inherit";
  const bin = findMcpBin();
  let child;
  if (bin) {
    child = spawn(bin, args, { stdio });
  } else {
    const npx = process.platform === "win32" ? "npx.cmd" : "npx";
    child = spawn(npx, ["-y", "chrome-devtools-mcp@^0.25.0", ...args], { stdio });
  }
  return child;
}

// --- Cleanup on exit ---

let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;

  const lock = readLock();
  if (!lock) return;

  lock.clients = Math.max(0, (lock.clients || 1) - 1);

  if (lock.clients > 0) {
    writeLock(lock);
  } else {
    try { process.kill(lock.pid, "SIGTERM"); } catch {}
    deleteLock();
  }
}

// --- Ensure Chrome is running (shared by eager and lazy paths) ---

async function ensureChrome(config, port) {
  let lock = readLock();

  if (lock && isProcessAlive(lock.pid) && await probePort(lock.port || port)) {
    lock.clients = (lock.clients || 0) + 1;
    writeLock(lock);
    process.stderr.write(`[my-agent-browser] reusing Chrome (PID ${lock.pid}, port ${lock.port || port}), clients: ${lock.clients}\n`);
    return;
  }

  // Another process may have started Chrome between our check and now — probe first
  if (await probePort(port)) {
    process.stderr.write(`[my-agent-browser] Chrome already listening on port ${port}, reusing\n`);
    writeLock({ port, pid: lock ? lock.pid : 0, clients: (lock ? lock.clients || 0 : 0) + 1 });
    return;
  }

  if (lock) {
    process.stderr.write(`[my-agent-browser] stale lock detected, cleaning up\n`);
    if (lock.pid && isProcessAlive(lock.pid)) {
      try { process.kill(lock.pid, "SIGTERM"); } catch {}
    }
    deleteLock();
  }

  const pid = launchChrome(config, port);
  process.stderr.write(`[my-agent-browser] launched Chrome (PID ${pid}, port ${port})\n`);

  const ready = await waitForPort(port);
  if (!ready || !isProcessAlive(pid)) {
    process.stderr.write(
      `[my-agent-browser] Chrome failed to start (port ${port} not reachable).\n` +
      `If port ${port} is already in use by another process, change "debuggingPort" in ${configFile}\n`
    );
    if (isProcessAlive(pid)) {
      try { process.kill(pid, "SIGTERM"); } catch {}
    }
    process.exit(1);
  }

  writeLock({ port, pid, clients: 1 });
}

// --- Lazy start: stdin proxy with on-demand Chrome launch ---

function startLazy(config, port) {
  const mcpArgs = buildMcpArgs(config, port);
  const child = startMcp(mcpArgs, { pipe: true });

  // State: "pending" → "launching" → "ready"
  let state = "pending";
  let buffer = [];

  function flushBuffer() {
    for (const chunk of buffer) child.stdin.write(chunk);
    buffer = null;
  }

  function switchToPassthrough() {
    state = "ready";
    flushBuffer();
    process.stdin.pipe(child.stdin);
  }

  async function onToolsCall(line) {
    state = "launching";
    buffer.push(line + "\n");
    process.stderr.write(`[my-agent-browser] first tools/call detected, launching Chrome...\n`);
    try {
      await ensureChrome(config, port);
    } catch (err) {
      process.stderr.write(`[my-agent-browser] Chrome launch failed: ${err.message}\n`);
    }
    switchToPassthrough();
  }

  // Parse stdin line by line while in pending/launching state
  let partial = "";
  process.stdin.on("data", (chunk) => {
    if (state === "ready") return; // piped, shouldn't fire but guard anyway

    if (state === "launching") {
      buffer.push(chunk);
      return;
    }

    // state === "pending": inspect each line
    partial += chunk.toString();
    const lines = partial.split("\n");
    partial = lines.pop(); // incomplete trailing line

    for (const line of lines) {
      if (!line.trim()) { child.stdin.write("\n"); continue; }
      let msg;
      try { msg = JSON.parse(line); } catch { child.stdin.write(line + "\n"); continue; }

      if (msg.method === "tools/call") {
        // Buffer remaining lines too
        if (partial) { buffer.push(partial); partial = ""; }
        for (let i = lines.indexOf(line) + 1; i < lines.length; i++) {
          buffer.push(lines[i] + "\n");
        }
        onToolsCall(line);
        return;
      }
      child.stdin.write(line + "\n");
    }
  });

  process.stdin.on("end", () => {
    if (child.stdin.writable) child.stdin.end();
  });

  child.stdout.pipe(process.stdout);

  return child;
}

// --- Main ---

async function main() {
  const config = loadConfig();
  const b = config.browser || {};
  const port = b.debuggingPort || DEFAULT_PORT;
  const lazyStart = b.lazyStart !== false; // default true

  // Direct connection mode: skip Chrome lifecycle management
  if (b.browserUrl) {
    process.stderr.write(`[my-agent-browser] direct mode: connecting to ${b.browserUrl}\n`);
    const m = config.mcp || {};
    const args = [`--browserUrl=${b.browserUrl}`];
    for (const f of m.features || []) args.push(f);
    for (const f of m.flags || []) args.push(f);
    const child = startMcp(args);
    child.on("error", (err) => {
      process.stderr.write(`[my-agent-browser] spawn error: ${err.message}\n`);
      process.exit(1);
    });
    child.on("exit", (code) => process.exit(code ?? 1));
    return;
  }

  // Register cleanup
  process.on("exit", cleanup);
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) {
    process.on(sig, () => { cleanup(); process.exit(0); });
  }

  let child;

  if (lazyStart) {
    process.stderr.write(`[my-agent-browser] lazy mode: Chrome will start on first tool call\n`);
    child = startLazy(config, port);
  } else {
    await ensureChrome(config, port);
    const mcpArgs = buildMcpArgs(config, port);
    child = startMcp(mcpArgs);
  }

  child.on("error", (err) => {
    process.stderr.write(`[my-agent-browser] spawn error: ${err.message}\n`);
    cleanup();
    process.exit(1);
  });
  child.on("exit", (code) => {
    cleanup();
    process.exit(code ?? 1);
  });
}

main().catch((err) => {
  process.stderr.write(`[my-agent-browser] fatal: ${err.message}\n`);
  process.exit(1);
});
