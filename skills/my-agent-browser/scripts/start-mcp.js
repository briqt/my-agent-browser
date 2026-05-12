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

const DEFAULT_PORT = 19222;

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
    const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve(true));
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

function startMcp(args) {
  const bin = findMcpBin();
  let child;
  if (bin) {
    child = spawn(bin, args, { stdio: "inherit" });
  } else {
    const npx = process.platform === "win32" ? "npx.cmd" : "npx";
    child = spawn(npx, ["-y", "chrome-devtools-mcp@^0.25.0", ...args], {
      stdio: "inherit",
    });
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

// --- Main ---

async function main() {
  const config = loadConfig();
  const b = config.browser || {};
  const port = b.debuggingPort || DEFAULT_PORT;

  let lock = readLock();
  let needLaunch = true;

  if (lock && isProcessAlive(lock.pid) && await probePort(lock.port || port)) {
    lock.clients = (lock.clients || 0) + 1;
    writeLock(lock);
    needLaunch = false;
    process.stderr.write(`[my-agent-browser] reusing Chrome (PID ${lock.pid}, port ${lock.port || port}), clients: ${lock.clients}\n`);
  } else {
    if (lock) {
      process.stderr.write(`[my-agent-browser] stale lock detected, cleaning up\n`);
      if (lock.pid && isProcessAlive(lock.pid)) {
        try { process.kill(lock.pid, "SIGTERM"); } catch {}
      }
      deleteLock();
    }
  }

  if (needLaunch) {
    const pid = launchChrome(config, port);
    process.stderr.write(`[my-agent-browser] launched Chrome (PID ${pid}, port ${port})\n`);

    const ready = await waitForPort(port);
    if (!ready) {
      process.stderr.write(`[my-agent-browser] Chrome failed to start (port ${port} not reachable)\n`);
      try { process.kill(pid, "SIGTERM"); } catch {}
      process.exit(1);
    }

    writeLock({ port, pid, clients: 1 });
  }

  // Register cleanup
  process.on("exit", cleanup);
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) {
    process.on(sig, () => { cleanup(); process.exit(0); });
  }

  // Start MCP server connecting to Chrome
  const mcpArgs = buildMcpArgs(config, port);
  const child = startMcp(mcpArgs);

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
