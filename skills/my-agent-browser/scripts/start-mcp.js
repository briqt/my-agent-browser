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
    const req = http.get({
      hostname: "127.0.0.1",
      port,
      path: "/json/version",
      timeout: timeoutMs,
      createConnection: () => net.connect({ host: "127.0.0.1", port }),
    }, (res) => {
      if (res.statusCode !== 200) { res.resume(); resolve(false); return; }
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try { resolve(!!JSON.parse(body).Browser); }
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
  // PATH-searchable names, ordered by preference
  const pathNames = process.platform === "win32"
    ? ["chrome.exe", "google-chrome.exe", "msedge.exe", "chromium.exe", "brave.exe"]
    : process.platform === "darwin"
      ? ["google-chrome", "chromium", "microsoft-edge"]
      : ["google-chrome", "google-chrome-stable", "chromium-browser", "chromium", "microsoft-edge-stable", "microsoft-edge", "brave-browser"];

  for (const name of pathNames) {
    try {
      const cmd = process.platform === "win32" ? "where" : "which";
      const result = execFileSync(cmd, [name], {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      if (result) return result.split(/\r?\n/)[0];
    } catch {}
  }

  // Well-known install paths per platform
  if (process.platform === "darwin") {
    const macPaths = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Arc.app/Contents/MacOS/Arc",
    ];
    for (const p of macPaths) {
      if (fs.existsSync(p)) return p;
    }
  }

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || "";
    const programFiles = process.env.PROGRAMFILES || "C:\\Program Files";
    const programFilesX86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
    const winPaths = [
      path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(programFiles, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
      path.join(localAppData, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
      path.join(localAppData, "Chromium", "Application", "chrome.exe"),
    ];
    for (const p of winPaths) {
      if (fs.existsSync(p)) return p;
    }
  }

  if (process.platform === "linux") {
    const linuxPaths = [
      "/opt/google/chrome/google-chrome",
      "/opt/microsoft/msedge/msedge",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium",
      "/snap/bin/chromium",
      "/usr/bin/brave-browser",
    ];
    for (const p of linuxPaths) {
      if (fs.existsSync(p)) return p;
    }
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
    const searchedPaths = process.platform === "darwin"
      ? "Google Chrome, Microsoft Edge, Chromium, Brave, Arc in /Applications and PATH"
      : process.platform === "win32"
        ? "Chrome, Edge, Brave, Chromium in Program Files, LocalAppData, and PATH"
        : "google-chrome, chromium, microsoft-edge, brave-browser via PATH and /opt";
    throw new Error(
      `Chrome/Chromium not found. Searched: ${searchedPaths}. ` +
      `Fix: (1) Install Google Chrome, (2) add it to PATH, or ` +
      `(3) set "browserUrl" in ~/.config/agent-skills/my-agent-browser/config.json ` +
      `to connect to an existing instance (e.g. "browserUrl": "http://127.0.0.1:9222").`
    );
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

  // Clean stale profile locks
  for (const lockName of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
    try { fs.unlinkSync(path.join(userDataDir, lockName)); } catch {}
  }

  const child = spawn(chromePath, args, { detached: true, stdio: "ignore" });
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
    if (!result) return null;
    const lines = result.split(/\r?\n/);
    if (process.platform === "win32") {
      // On Windows, spawn cannot execute .cmd or extensionless shims directly.
      // Resolve the underlying .js entry point from the npm prefix directory.
      const anyPath = lines[0];
      const dir = path.dirname(anyPath);
      const jsEntry = path.join(dir, "node_modules", "chrome-devtools-mcp", "build", "src", "bin", "chrome-devtools-mcp.js");
      if (fs.existsSync(jsEntry)) return jsEntry;
    }
    return lines[0];
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
  if (bin) {
    // If we resolved to a .js file, run it with node
    if (bin.endsWith(".js")) return spawn(process.execPath, [bin, ...args], { stdio });
    return spawn(bin, args, { stdio });
  }
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  return spawn(npx, ["-y", "chrome-devtools-mcp@^0.25.0", ...args], { stdio });
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

// --- Ensure Chrome is running ---

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

  const pid = launchChrome(config, port);
  process.stderr.write(`[my-agent-browser] launched Chrome (PID ${pid}, port ${port})\n`);

  const ready = await waitForPort(port);
  if (!ready || !isProcessAlive(pid)) {
    if (isProcessAlive(pid)) {
      try { process.kill(pid, "SIGTERM"); } catch {}
    }
    throw new Error(`Chrome failed to start (port ${port} not reachable)`);
  }

  writeLock({ port, pid, clients: 1 });
}

// --- Chrome connection error patterns ---
const CHROME_DEAD_PATTERNS = [
  "Could not connect to Chrome",
  "Failed to fetch browser webSocket URL",
  "Target closed",
  "Session closed",
  "WebSocket is not open",
  "Connection refused",
  "Timed out",
  "timed out",
  "ETIMEDOUT",
  "ECONNREFUSED",
];

// Errors indicating the MCP process has stale internal state (e.g. selectedPage
// references a closed tab) but Chrome itself is fine. Recovery: restart the MCP
// child so it reconnects and rebuilds its context.
const MCP_STALE_STATE_PATTERNS = [
  "The selected page has been closed",
  "No page selected",
];

function isChromeDeadError(text) {
  if (!text) return false;
  return CHROME_DEAD_PATTERNS.some((p) => text.includes(p));
}

function isMcpStaleStateError(text) {
  if (!text) return false;
  return MCP_STALE_STATE_PATTERNS.some((p) => text.includes(p));
}

function responseHasChromeError(line) {
  try {
    const msg = JSON.parse(line);
    if (msg.error && msg.error.message && isChromeDeadError(msg.error.message)) return true;
    if (msg.result && Array.isArray(msg.result.content)) {
      for (const item of msg.result.content) {
        if (item.type === "text" && isChromeDeadError(item.text)) return true;
      }
    }
  } catch {}
  return false;
}

function responseHasStaleStateError(line) {
  try {
    const msg = JSON.parse(line);
    if (msg.error && msg.error.message && isMcpStaleStateError(msg.error.message)) return true;
    if (msg.result && Array.isArray(msg.result.content)) {
      for (const item of msg.result.content) {
        if (item.type === "text" && isMcpStaleStateError(item.text)) return true;
      }
    }
  } catch {}
  return false;
}

// --- Lazy start: stdin proxy with on-demand Chrome launch ---

function startLazy(config, port) {
  const mcpArgs = buildMcpArgs(config, port);
  let child = startMcp(mcpArgs, { pipe: true });

  let state = "pending"; // "pending" → "launching" → "ready" | "failed"
  let buffer = [];
  let partial = "";
  let relaunching = false;
  let launchError = null;

  function flushAndPipe() {
    state = "ready";
    for (const chunk of buffer) child.stdin.write(chunk);
    buffer = null;
    process.stdin.pipe(child.stdin);
  }

  function sendMcpError(requestLine, errorMessage) {
    try {
      const msg = JSON.parse(requestLine);
      if (msg.id != null) {
        const response = {
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            content: [{ type: "text", text: `[my-agent-browser] ${errorMessage}` }],
            isError: true,
          },
        };
        process.stdout.write(JSON.stringify(response) + "\n");
      }
    } catch {}
  }

  async function onToolsCall(line) {
    state = "launching";
    process.stderr.write(`[my-agent-browser] first tools/call detected, launching Chrome...\n`);
    try {
      await ensureChrome(config, port);
    } catch (err) {
      launchError = err.message;
      state = "failed";
      process.stderr.write(`[my-agent-browser] Chrome launch failed: ${err.message}\n`);
      sendMcpError(line, err.message);
      for (const chunk of buffer) {
        const lines = chunk.toString().split("\n");
        for (const l of lines) {
          if (!l.trim()) continue;
          try { const m = JSON.parse(l); if (m.method === "tools/call") sendMcpError(l, err.message); } catch {}
        }
      }
      buffer = null;
      return;
    }
    buffer.push(line + "\n");
    flushAndPipe();
  }

  // Silently relaunch Chrome when a connection error is detected
  async function relaunchChrome() {
    if (relaunching) return;
    relaunching = true;
    process.stderr.write(`[my-agent-browser] Chrome connection lost, relaunching...\n`);
    try {
      deleteLock();
      await ensureChrome(config, port);
      process.stderr.write(`[my-agent-browser] Chrome relaunched, next tool call will reconnect\n`);
    } catch (err) {
      process.stderr.write(`[my-agent-browser] Chrome relaunch failed: ${err.message}\n`);
    }
    relaunching = false;
  }

  // Restart the MCP child process when it has stale internal state.
  // Chrome is fine — only the MCP process needs to reconnect and rebuild context.
  let restarting = false;
  function restartMcpChild() {
    if (restarting) return;
    restarting = true;
    process.stderr.write(`[my-agent-browser] MCP process has stale state, restarting...\n`);

    // Kill the old child
    try { child.kill("SIGTERM"); } catch {}

    // Spawn a new MCP child with the same args
    const newChild = startMcp(mcpArgs, { pipe: true });

    // Re-wire stdout proxy on the new child
    let newStdoutPartial = "";
    newChild.stdout.on("data", (chunk) => {
      newStdoutPartial += chunk.toString();
      const lines = newStdoutPartial.split("\n");
      newStdoutPartial = lines.pop();
      for (const line of lines) {
        if (responseHasChromeError(line)) {
          relaunchChrome();
          try {
            const msg = JSON.parse(line);
            const rewritten = {
              ...msg,
              result: {
                content: [{ type: "text", text: "Chrome was closed or crashed. All open pages and browser state are lost. Chrome is being relaunched automatically — please navigate to your target URL again." }],
                isError: true,
              },
            };
            if (msg.error) delete rewritten.error;
            process.stdout.write(JSON.stringify(rewritten) + "\n");
          } catch {
            process.stdout.write(line + "\n");
          }
          continue;
        }
        if (responseHasStaleStateError(line)) {
          // Avoid infinite restart loops — just pass through on second occurrence
          process.stderr.write(`[my-agent-browser] stale state error persists after restart, passing through\n`);
          process.stdout.write(line + "\n");
          continue;
        }
        process.stdout.write(line + "\n");
      }
    });
    newChild.stdout.on("end", () => {
      if (newStdoutPartial) { process.stdout.write(newStdoutPartial); newStdoutPartial = ""; }
    });

    // Re-pipe stdin to new child
    process.stdin.unpipe(child.stdin);
    process.stdin.pipe(newChild.stdin);

    // Update the child reference and event handlers
    newChild.on("error", (err) => {
      process.stderr.write(`[my-agent-browser] spawn error: ${err.message}\n`);
      cleanup();
      process.exit(1);
    });
    newChild.on("exit", (code) => {
      cleanup();
      process.exit(code ?? 1);
    });

    // Replace the outer child reference (used by cleanup and event handlers)
    child = newChild;
    restarting = false;
    process.stderr.write(`[my-agent-browser] MCP process restarted successfully\n`);
  }

  process.stdin.on("data", (chunk) => {
    if (state === "ready") return;

    if (state === "failed") {
      const text = chunk.toString();
      const lines = text.split("\n");
      for (const l of lines) {
        if (!l.trim()) continue;
        try {
          const m = JSON.parse(l);
          if (m.method === "tools/call") sendMcpError(l, launchError);
        } catch {}
      }
      return;
    }

    if (state === "launching") {
      buffer.push(chunk);
      return;
    }

    partial += chunk.toString();
    const lines = partial.split("\n");
    partial = lines.pop();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) { child.stdin.write("\n"); continue; }
      let msg;
      try { msg = JSON.parse(line); } catch { child.stdin.write(line + "\n"); continue; }

      if (msg.method === "tools/call") {
        if (partial) { buffer.push(partial); partial = ""; }
        for (let j = i + 1; j < lines.length; j++) {
          buffer.push(lines[j] + "\n");
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

  // stdout proxy: relay lines, detect Chrome errors, trigger relaunch
  let stdoutPartial = "";
  child.stdout.on("data", (chunk) => {
    stdoutPartial += chunk.toString();
    const lines = stdoutPartial.split("\n");
    stdoutPartial = lines.pop();
    for (const line of lines) {
      if (state === "ready" && responseHasChromeError(line)) {
        relaunchChrome();
        // Rewrite the error message to be actionable for the agent
        try {
          const msg = JSON.parse(line);
          const rewritten = {
            ...msg,
            result: {
              content: [{ type: "text", text: "Chrome was closed or crashed. All open pages and browser state are lost. Chrome is being relaunched automatically — please navigate to your target URL again." }],
              isError: true,
            },
          };
          if (msg.error) {
            delete rewritten.error;
          }
          process.stdout.write(JSON.stringify(rewritten) + "\n");
        } catch {
          process.stdout.write(line + "\n");
        }
        continue;
      }
      if (state === "ready" && responseHasStaleStateError(line)) {
        restartMcpChild();
        // Rewrite the error to tell the agent to retry
        try {
          const msg = JSON.parse(line);
          const rewritten = {
            ...msg,
            result: {
              content: [{ type: "text", text: "The browser session had stale state and has been automatically recovered. Please retry your last action." }],
              isError: true,
            },
          };
          if (msg.error) {
            delete rewritten.error;
          }
          process.stdout.write(JSON.stringify(rewritten) + "\n");
        } catch {
          process.stdout.write(line + "\n");
        }
        continue;
      }
      process.stdout.write(line + "\n");
    }
  });
  child.stdout.on("end", () => {
    if (stdoutPartial) { process.stdout.write(stdoutPartial); stdoutPartial = ""; }
  });

  return child;
}

// --- Main ---

async function main() {
  const config = loadConfig();
  const b = config.browser || {};
  const port = b.debuggingPort || DEFAULT_PORT;
  const lazyStart = b.lazyStart !== false;

  // Direct connection mode
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
  process.stderr.write(`[my-agent-browser] FATAL: ${err.message}\n`);
  process.stderr.write(`[my-agent-browser] The MCP server cannot start. Fix the issue above and restart your agent session.\n`);
  process.exit(1);
});
