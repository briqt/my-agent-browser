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
const MAX_RECOVERIES = 3;
const PORT_POLL_INTERVAL_MS = 3000;
const PORT_POLL_TIMEOUT_MS = 2000;

// --- Chrome crash detection patterns ---
const CRASH_PATTERNS = [
  "Could not connect to Chrome",
  "Failed to fetch browser webSocket URL",
  "Target closed",
  "Session closed",
  "WebSocket is not open",
  "Connection refused",
];

function isCrashError(text) {
  if (!text) return false;
  return CRASH_PATTERNS.some((p) => text.includes(p));
}

function expandHome(p) {
  if (p.startsWith("~/") || p === "~") {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

function loadConfig() {
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
    const net = require("net");
    const opts = {
      hostname: "127.0.0.1",
      port,
      path: "/json/version",
      timeout: timeoutMs,
      createConnection: (connOpts) => {
        return net.connect({ host: "127.0.0.1", port });
      },
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

function spawnMcpChild(args) {
  const bin = findMcpBin();
  if (bin) {
    return spawn(bin, args, { stdio: ["pipe", "pipe", "inherit"] });
  }
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  return spawn(npx, ["-y", "chrome-devtools-mcp@^0.25.0", ...args], { stdio: ["pipe", "pipe", "inherit"] });
}

function startMcp(args, { pipe = false } = {}) {
  const stdio = pipe ? ["pipe", "pipe", "inherit"] : "inherit";
  const bin = findMcpBin();
  if (bin) {
    return spawn(bin, args, { stdio });
  }
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  return spawn(npx, ["-y", "chrome-devtools-mcp@^0.25.0", ...args], { stdio });
}

// --- Cleanup on exit ---

let cleanedUp = false;
let recovering = false; // suppresses cleanup during crash recovery

function cleanup() {
  if (cleanedUp) return;
  if (recovering) return; // don't decrement clients mid-recovery
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

  // Clean stale Chrome profile locks before launching
  const dataDir = (config.browser || {}).userDataDir
    ? expandHome((config.browser || {}).userDataDir)
    : path.join(configDir, "user-data");
  for (const lockName of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
    try { fs.unlinkSync(path.join(dataDir, lockName)); } catch {}
  }

  const pid = launchChrome(config, port);
  process.stderr.write(`[my-agent-browser] launched Chrome (PID ${pid}, port ${port})\n`);

  const ready = await waitForPort(port);
  if (!ready || !isProcessAlive(pid)) {
    const msg = `Chrome failed to start (port ${port} not reachable).`;
    process.stderr.write(
      `[my-agent-browser] ${msg}\n` +
      `If port ${port} is already in use by another process, change "debuggingPort" in ${configFile}\n`
    );
    if (isProcessAlive(pid)) {
      try { process.kill(pid, "SIGTERM"); } catch {}
    }
    throw new Error(msg);
  }

  writeLock({ port, pid, clients: 1 });
}

// --- Lazy start with crash recovery ---
//
// Detection: dual-mode
//   1. stdout interception: parse each JSON-RPC response line for crash patterns
//   2. Port monitor: poll Chrome debug port every PORT_POLL_INTERVAL_MS
// Recovery: kill old child -> ensureChrome() -> spawn new child -> replay last request
// The child exit handler is the single entry point for recovery logic.

function startLazyWithRecovery(config, port, { eager = false } = {}) {
  const mcpArgs = buildMcpArgs(config, port);

  // Lazy state: "pending" -> "launching" -> "ready"
  // In eager mode, start directly in "ready" state (Chrome already running)
  let lazyState = eager ? "ready" : "pending";
  let lazyBuffer = eager ? null : [];

  // Recovery state (active once lazyState === "ready")
  let child = null;
  let portDead = false;
  let recoveryCount = 0;
  let recoveryDisabled = false;
  let portMonitorTimer = null;
  let stdinBuffer = [];
  let lastSentRequest = null;
  let initHandshake = null; // captured initialize + notifications/initialized
  let suppressResponseIds = new Set(); // IDs whose responses should not be forwarded
  let stdinPartial = "";
  let stdoutPartial = "";
  let sessionEnded = false;

  // --- Detect Chrome crash patterns in a stdout line ---

  function detectCrashInLine(line) {
    try {
      const msg = JSON.parse(line);
      if (msg.error && msg.error.message && isCrashError(msg.error.message)) return true;
      if (msg.result && Array.isArray(msg.result.content)) {
        for (const item of msg.result.content) {
          if (item.type === "text" && isCrashError(item.text)) return true;
        }
      }
    } catch {}
    return false;
  }

  // --- Spawn child and wire stdout + exit handler ---

  function spawnAndWire() {
    child = spawnMcpChild(mcpArgs);
    stdoutPartial = "";

    // stdout relay: line-by-line with crash error detection
    child.stdout.on("data", (chunk) => {
      stdoutPartial += chunk.toString();
      const lines = stdoutPartial.split("\n");
      stdoutPartial = lines.pop();
      for (const line of lines) {
        if (!line.trim()) { process.stdout.write("\n"); continue; }

        // Suppress responses to recovery-replayed init handshake
        if (suppressResponseIds.size > 0) {
          try {
            const msg = JSON.parse(line);
            if (msg.id !== undefined && suppressResponseIds.has(msg.id)) {
              suppressResponseIds.delete(msg.id);
              continue;
            }
          } catch {}
        }

        // Detect Chrome crash errors in responses (only in ready state)
        if (lazyState === "ready" && !portDead && !recoveryDisabled && detectCrashInLine(line)) {
          process.stderr.write(`[my-agent-browser] stdout: Chrome crash error detected, forwarding error then recovering\n`);
          // Forward the error response to the client FIRST so it doesn't timeout
          process.stdout.write(line + "\n");
          portDead = true;
          recovering = true;
          try { child.kill("SIGTERM"); } catch {}
          setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 2000).unref();
          return; // exit handler will trigger recovery
        }

        process.stdout.write(line + "\n");
      }
    });

    child.stdout.on("end", () => {
      if (stdoutPartial) {
        process.stdout.write(stdoutPartial);
        stdoutPartial = "";
      }
    });

    child.on("exit", (code, signal) => {
      if ((portDead || recovering) && !recoveryDisabled && lazyState === "ready") {
        performRecovery();
      } else {
        cleanup();
        process.exit(code ?? 1);
      }
    });

    child.on("error", (err) => {
      if (portDead && !recoveryDisabled) return;
      process.stderr.write(`[my-agent-browser] child error: ${err.message}\n`);
      cleanup();
      process.exit(1);
    });
  }

  // --- Port monitor (proactive crash detection) ---

  function startPortMonitor() {
    if (portMonitorTimer) return;
    portMonitorTimer = setInterval(async () => {
      if (portDead) return;
      if (recoveryDisabled) return;
      if (lazyState !== "ready") return;

      const alive = await probePort(port, PORT_POLL_TIMEOUT_MS);
      if (!alive) {
        // Double-check to avoid false positives
        await new Promise((r) => setTimeout(r, 500));
        const stillDead = !(await probePort(port, PORT_POLL_TIMEOUT_MS));
        if (!stillDead) return;

        process.stderr.write(`[my-agent-browser] port monitor: Chrome not responding on port ${port}\n`);
        portDead = true;
        recovering = true;

        try { child.kill("SIGTERM"); } catch {}
        setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 2000).unref();
      }
    }, PORT_POLL_INTERVAL_MS);
  }

  // --- Recovery (called from child exit handler) ---

  async function performRecovery() {
    recoveryCount++;
    if (recoveryCount > MAX_RECOVERIES) {
      process.stderr.write(`[my-agent-browser] max recovery attempts (${MAX_RECOVERIES}) reached, falling back to passthrough\n`);
      recoveryDisabled = true;
      recovering = false;
      portDead = false;
      // Don't exit - stay alive in degraded mode so manual Chrome restart can work
      spawnAndWire();
      return;
    }

    process.stderr.write(`[my-agent-browser] recovery attempt ${recoveryCount}/${MAX_RECOVERIES}...\n`);

    try {
      await ensureChrome(config, port);
    } catch (err) {
      process.stderr.write(`[my-agent-browser] recovery: Chrome relaunch failed: ${err.message}\n`);
      // Retry by recursing (respects MAX_RECOVERIES)
      portDead = true;
      recovering = true;
      await performRecovery();
      return;
    }

    spawnAndWire();
    await new Promise((r) => setTimeout(r, 500));

    // Re-send MCP handshake so the new child is in initialized state
    if (initHandshake && child.stdin.writable) {
      for (const line of initHandshake) {
        try {
          const msg = JSON.parse(line);
          if (msg.id !== undefined) suppressResponseIds.add(msg.id);
        } catch {}
        child.stdin.write(line + "\n");
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    // Replay the last tools/call request
    if (lastSentRequest && child.stdin.writable) {
      process.stderr.write(`[my-agent-browser] recovery: replaying last request\n`);
      child.stdin.write(lastSentRequest + "\n");
    }

    // Flush buffered stdin
    if (stdinBuffer.length > 0) {
      process.stderr.write(`[my-agent-browser] recovery: flushing ${stdinBuffer.length} buffered stdin chunks\n`);
      for (const chunk of stdinBuffer) {
        if (child.stdin.writable) child.stdin.write(chunk);
      }
      stdinBuffer = [];
    }

    if (sessionEnded && child.stdin.writable) {
      child.stdin.end();
    }

    portDead = false;
    recovering = false;
    process.stderr.write(`[my-agent-browser] recovery: complete, session restored\n`);
  }

  // --- Stdin handling (combines lazy detection + recovery buffering + relay) ---

  function handleStdinData(chunk) {
    const text = chunk.toString();

    // During recovery, buffer everything
    if (portDead || recovering) {
      stdinBuffer.push(text);
      return;
    }

    // Lazy: still waiting for Chrome launch to complete
    if (lazyState === "launching") {
      lazyBuffer.push(text);
      return;
    }

    // Lazy: scanning for first tools/call
    if (lazyState === "pending") {
      stdinPartial += text;
      const lines = stdinPartial.split("\n");
      stdinPartial = lines.pop();

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) {
          if (child && child.stdin && child.stdin.writable) child.stdin.write("\n");
          continue;
        }
        let msg;
        try { msg = JSON.parse(line); } catch {
          if (child && child.stdin && child.stdin.writable) child.stdin.write(line + "\n");
          continue;
        }

        if (msg.method === "tools/call") {
          // Buffer this line and everything remaining
          lazyBuffer.push(line + "\n");
          if (stdinPartial) { lazyBuffer.push(stdinPartial); stdinPartial = ""; }
          for (let j = i + 1; j < lines.length; j++) {
            lazyBuffer.push(lines[j] + "\n");
          }
          onFirstToolsCall();
          return;
        }
        // Capture init handshake for recovery replay
        if (msg.method === "initialize" || msg.method === "notifications/initialized") {
          if (!initHandshake) initHandshake = [];
          initHandshake.push(line);
        }
        if (child && child.stdin && child.stdin.writable) child.stdin.write(line + "\n");
      }
      return;
    }

    // lazyState === "ready": normal relay with request tracking
    stdinPartial += text;
    const lines = stdinPartial.split("\n");
    stdinPartial = lines.pop();

    for (const line of lines) {
      if (line.trim()) {
        try {
          const msg = JSON.parse(line);
          if (msg.method === "tools/call") {
            lastSentRequest = line;
          }
          if (msg.method === "initialize" || msg.method === "notifications/initialized") {
            if (!initHandshake) initHandshake = [];
            initHandshake.push(line);
          }
        } catch {}
      }
      if (child && child.stdin && child.stdin.writable) {
        child.stdin.write(line + "\n");
      }
    }
  }

  async function onFirstToolsCall() {
    lazyState = "launching";
    process.stderr.write(`[my-agent-browser] first tools/call detected, launching Chrome...\n`);
    try {
      await ensureChrome(config, port);
    } catch (err) {
      process.stderr.write(`[my-agent-browser] Chrome launch failed: ${err.message}\n`);
    }

    // Transition to ready and flush lazy buffer
    lazyState = "ready";
    for (const chunk of lazyBuffer) {
      if (typeof chunk === "string") {
        const bufLines = chunk.split("\n");
        for (const bl of bufLines) {
          if (bl.trim()) {
            try {
              const m = JSON.parse(bl);
              if (m.method === "tools/call") lastSentRequest = bl;
            } catch {}
          }
        }
      }
      if (child && child.stdin && child.stdin.writable) child.stdin.write(chunk);
    }
    lazyBuffer = null;

    // Start port monitor now that Chrome is running
    startPortMonitor();
  }

  // --- Initialize ---
  spawnAndWire();

  process.stdin.on("data", handleStdinData);
  process.stdin.on("end", () => {
    sessionEnded = true;
    if (stdinPartial && child && child.stdin && child.stdin.writable) {
      child.stdin.write(stdinPartial);
      stdinPartial = "";
    }
    if (child && child.stdin && child.stdin.writable) {
      child.stdin.end();
    }
  });

  // In eager mode, Chrome is already running — start monitoring immediately
  if (eager) {
    startPortMonitor();
  }
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

  if (lazyStart) {
    process.stderr.write(`[my-agent-browser] lazy mode: Chrome will start on first tool call (crash recovery enabled)\n`);
    startLazyWithRecovery(config, port);
  } else {
    await ensureChrome(config, port);
    process.stderr.write(`[my-agent-browser] eager mode: Chrome ready (crash recovery enabled)\n`);
    startLazyWithRecovery(config, port, { eager: true });
  }
}

main().catch((err) => {
  process.stderr.write(`[my-agent-browser] fatal: ${err.message}\n`);
  process.exit(1);
});
