#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const { execFileSync, spawn } = require("child_process");

const { McpSession } = require("./mcp-session.js");
const VERSION = "1.3.0";
const MCP_VERSION = "1.11.0";
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

function pruneDeadClients(lock) {
  if (!lock.clientPids) return lock;
  const before = lock.clientPids.length;
  lock.clientPids = lock.clientPids.filter(pid => pid === process.pid || isProcessAlive(pid));
  lock.clients = lock.clientPids.length;
  const pruned = before - lock.clientPids.length;
  if (pruned > 0) {
    process.stderr.write(`[my-agent-browser] pruned ${pruned} dead client(s) from lock\n`);
  }
  return lock;
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

// Build the Chrome command-line arguments from browser config.
// Pure function (no side effects) so it can be unit-tested in isolation.
function buildChromeArgs(b, port, userDataDir) {
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-crash-restore-bubble",
  ];

  if (b.headless) args.push("--headless=new");
  if (b.proxy) args.push(`--proxy-server=${b.proxy}`);
  // viewport controls the launched window size:
  //  - "maximized": open a maximized window. --start-maximized needs a window
  //    manager, so it is a no-op in headless mode — there we fall back to a large
  //    fixed size instead.
  //  - "WIDTHxHEIGHT": fixed size.
  //  - unset/empty: Chrome default.
  if (b.viewport === "maximized") {
    if (b.headless) {
      args.push("--window-size=1920,1080");
    } else {
      args.push("--start-maximized");
    }
  } else if (b.viewport) {
    const [w, h] = String(b.viewport).split("x");
    args.push(`--window-size=${w},${h}`);
  }
  for (const arg of b.extraArgs || []) args.push(arg);

  return args;
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

  const args = buildChromeArgs(b, port, userDataDir);

  // Clean stale profile locks
  for (const lockName of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
    try { fs.unlinkSync(path.join(userDataDir, lockName)); } catch {}
  }

  const env = buildChromeEnv(b);
  const child = spawn(chromePath, args, { detached: true, stdio: "ignore", env });
  child.unref();
  return child.pid;
}

function buildChromeEnv(browserConfig) {
  const env = { ...process.env };

  // On Linux without DISPLAY, Chrome cannot open a GUI window and may fail or
  // run invisibly. Detect common display servers and set DISPLAY/WAYLAND_DISPLAY
  // so Chrome can render when a display is available.
  // - Skip on macOS/Windows (they don't use DISPLAY).
  // - Never override an already-set variable (respect explicit user config).
  // - If no display server is detected, leave env unchanged (Chrome will run
  //   headless-like without crashing thanks to --disable-gpu in extraArgs).
  if (process.platform !== "linux") return env;

  if (!env.DISPLAY) {
    // WSL2 with WSLg always exposes /tmp/.X11-unix/X0
    if (fs.existsSync("/tmp/.X11-unix/X0")) {
      env.DISPLAY = ":0";
    }
    // Fallback: explicit config value
    else if (browserConfig.display) {
      env.DISPLAY = browserConfig.display;
    }
  }

  if (!env.WAYLAND_DISPLAY) {
    // WSLg also provides a Wayland socket
    if (fs.existsSync("/run/user/" + (process.getuid?.() || 1000) + "/wayland-0")) {
      env.WAYLAND_DISPLAY = "wayland-0";
    }
  }

  return env;
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

function findMcpVersion(binary) {
  if (!binary) return null;
  try {
    let current = path.dirname(fs.realpathSync(binary));
    for (let i = 0; i < 8; i++) {
      const manifest = path.join(current, "package.json");
      if (fs.existsSync(manifest)) {
        const data = JSON.parse(fs.readFileSync(manifest, "utf8"));
        if (data.name === "chrome-devtools-mcp") return data.version;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  } catch {}
  return null;
}


function buildMcpArgs(config, browserUrl) {
  const m = config.mcp || {};
  const args = [`--browserUrl=${browserUrl}`];
  for (const f of m.features || []) args.push(f);
  for (const f of m.flags || []) args.push(f);
  return args;
}

function localBrowserUrl(port) {
  return `http://127.0.0.1:${port}`;
}

// --- Stealth: keep automation traces out of page-visible stack traces ---

// puppeteer tags every script it evaluates with `//# sourceURL=pptr:...`, and that
// generated URL embeds the absolute path of the chrome-devtools-mcp install — which
// on most machines contains the OS username. Any page-side getter, patched native or
// wrapped console can read it back out of `new Error().stack` while our script runs.
//
// puppeteer skips its own tag when the script already carries a sourceURL comment
// (see withSourcePuppeteerURLIfNone in puppeteer-core). We use that documented escape
// hatch, matching its regex exactly so the two stay in sync.
const SOURCE_URL_REGEX = /^[\x20\t]*\/\/[@#] sourceURL=\s{0,10}(\S*?)\s{0,10}$/m;

const DEFAULT_STEALTH_SOURCE_URL = "eval.js";

function stealthConfig(config) {
  const s = (config && config.stealth) || {};
  const enabled = s.evaluateScript !== false;
  const raw = typeof s.sourceUrl === "string" ? s.sourceUrl.trim() : "";
  // Whitespace would terminate the `//# sourceURL=` comment and corrupt the script,
  // so anything that isn't a single clean token falls back to the default.
  const sourceUrl = raw && !/\s/.test(raw) ? raw : DEFAULT_STEALTH_SOURCE_URL;
  return { enabled, sourceUrl };
}

// Wrap a user function so it runs from a fresh timer stack instead of directly under
// puppeteer's wrapper frame, and give it a benign sourceURL. A page-side trap then
// sees only `at <sourceUrl>` — no `pptr:` frame and no filesystem path.
//
// Two details matter:
//  - the newline before the closing paren, because chrome-devtools-mcp evaluates the
//    text as `(${fn})` and a trailing line comment would otherwise swallow the paren;
//  - the trailing newline after the sourceURL comment, for the same reason.
function wrapStealthFunction(fnText, sourceUrl) {
  return (
    `(...__args) => new Promise((__resolve, __reject) => {\n` +
    `  setTimeout(() => {\n` +
    `    try { __resolve((${fnText}\n)(...__args)); } catch (__err) { __reject(__err); }\n` +
    `  }, 0);\n` +
    `})\n//# sourceURL=${sourceUrl}\n`
  );
}

// Rewrite an outgoing JSON-RPC line before it reaches the MCP child. Any parse failure
// or unexpected shape returns the line untouched — this must never drop a message.
function rewriteClientLine(line, stealth) {
  if (!stealth || !stealth.enabled) return line;
  if (!line.includes("evaluate_script")) return line;
  let msg;
  try { msg = JSON.parse(line); } catch { return line; }
  if (msg.method !== "tools/call") return line;
  // MCP 1.11 script mode uses classic-script semantics, not a callable function.
  // File sources stay with upstream so its negotiated workspace checks are preserved.
  if (msg.params?.arguments?.format === "script" || msg.params?.arguments?.sourcePath !== undefined) return line;
  const params = msg.params;
  if (!params || params.name !== "evaluate_script") return line;
  const args = params.arguments;
  if (!args || typeof args.function !== "string") return line;
  // The caller supplied their own sourceURL — respect it and stay out of the way.
  if (SOURCE_URL_REGEX.test(args.function)) return line;
  args.function = wrapStealthFunction(args.function, stealth.sourceUrl);
  try { return JSON.stringify(msg); } catch { return line; }
}

// Opt-in default for new tabs. Explicit arguments (even invalid ones) stay with
// upstream; disabled policies preserve the original message byte-for-byte.
function rewriteNewPageBackground(line, config) {
  if (config?.mcp?.backgroundNewPages !== true) return line;
  let msg;
  try { msg = JSON.parse(line); } catch { return line; }
  if (msg?.method !== "tools/call" || msg.params?.name !== "new_page") return line;
  const args = msg.params.arguments;
  if (!args || typeof args !== "object" || Array.isArray(args) || Object.hasOwn(args, "background")) return line;
  args.background = true;
  try { return JSON.stringify(msg); } catch { return line; }
}

function rewriteClientRequest(line, config) {
  return rewriteClientLine(rewriteNewPageBackground(line, config), stealthConfig(config));
}

function buildNoProxyEnv() {
  // Node.js undici (globalThis.fetch) does NOT support shell wildcards (127.*)
  // or CIDR (127.0.0.0/8) in NO_PROXY. It only matches exact hostnames/IPs or
  // suffix patterns (.example.com). Ensure 127.0.0.1 and localhost are always
  // present so the MCP↔Chrome CDP connection bypasses any configured proxy.
  const loopback = ["127.0.0.1", "localhost"];
  const existing = process.env.no_proxy || process.env.NO_PROXY || "";
  const entries = existing ? existing.split(",").map(s => s.trim()) : [];
  for (const addr of loopback) {
    if (!entries.includes(addr)) entries.push(addr);
  }
  const merged = entries.join(",");
  return { ...process.env, no_proxy: merged, NO_PROXY: merged };
}

function startMcp(args, { pipe = false } = {}) {
  const stdio = pipe ? ["pipe", "pipe", "inherit"] : "inherit";
  const env = buildNoProxyEnv();
  const bin = findMcpBin();
  if (bin) {
    if (bin.endsWith(".js")) return spawn(process.execPath, [bin, ...args], { stdio, env });
    return spawn(bin, args, { stdio, env });
  }
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  return spawn(npx, ["-y", `chrome-devtools-mcp@${MCP_VERSION}`, ...args], { stdio, env });
}

// Run the MCP child with its stdio proxied, so client→server lines pass through
// rewriteClientRequest. Shared by lazy, eager and direct connection modes.
function createMcpSession(args, config, shouldRecover = responseHasStaleStateError) {
  return new McpSession({
    spawnChild: () => startMcp(args, { pipe: true }),
    rewriteLine: line => rewriteClientRequest(line, config),
    shouldRecover,
    log: message => process.stderr.write(`[my-agent-browser] ${message}\n`),
  });
}

function startMcpProxied(args, config) {
  const session = createMcpSession(args, config);
  session.on("line", line => process.stdout.write(line + "\n"));
  let partial = "";
  process.stdin.on("data", chunk => {
    partial += chunk.toString();
    const lines = partial.split("\n"); partial = lines.pop();
    for (const line of lines) session.write(line);
  });
  process.stdin.on("end", () => session.end());
  return session;
}

// --- Cleanup on exit ---

let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;

  const lock = readLock();
  if (!lock) return;

  if (lock.clientPids) {
    lock.clientPids = lock.clientPids.filter(p => p !== process.pid);
    lock.clients = lock.clientPids.length;
  } else {
    lock.clients = Math.max(0, (lock.clients || 1) - 1);
  }

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
    if (!lock.clientPids) lock.clientPids = [];
    lock = pruneDeadClients(lock);
    if (!lock.clientPids.includes(process.pid)) lock.clientPids.push(process.pid);
    lock.clients = lock.clientPids.length;
    writeLock(lock);
    process.stderr.write(`[my-agent-browser] reusing Chrome (PID ${lock.pid}, port ${lock.port || port}), clients: ${lock.clients}\n`);
    return;
  }

  if (await probePort(port)) {
    process.stderr.write(`[my-agent-browser] Chrome already listening on port ${port}, reusing\n`);
    const clientPids = lock && lock.clientPids ? lock.clientPids.filter(p => isProcessAlive(p)) : [];
    if (!clientPids.includes(process.pid)) clientPids.push(process.pid);
    writeLock({ port, pid: lock ? lock.pid : 0, clients: clientPids.length, clientPids });
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

  writeLock({ port, pid, clients: 1, clientPids: [process.pid] });
}

// --- Chrome connection error patterns ---
// These patterns SUGGEST Chrome might be dead. We never trust them alone —
// always probe the port before concluding Chrome crashed.
const CHROME_ERROR_PATTERNS = [
  "Could not connect to Chrome",
  "Failed to fetch browser webSocket URL",
  "WebSocket is not open",
  "Connection refused",
  "ECONNREFUSED",
  "Target closed",
  "Session closed",
];

// Errors indicating the MCP process has stale internal state (e.g. selectedPage
// references a closed tab) but Chrome itself is fine. Recovery: restart the MCP
// child so it reconnects and rebuilds its context.
const MCP_STALE_STATE_PATTERNS = [
  "The selected page has been closed",
  "No page selected",
];

function isChromeError(text) {
  if (!text) return false;
  return CHROME_ERROR_PATTERNS.some((p) => text.includes(p));
}

function isMcpStaleStateError(text) {
  if (!text) return false;
  return MCP_STALE_STATE_PATTERNS.some((p) => text.includes(p));
}

function responseHasChromeError(line) {
  try {
    const msg = JSON.parse(line);
    const texts = [];
    if (msg.error && msg.error.message) texts.push(msg.error.message);
    if (msg.result && Array.isArray(msg.result.content)) {
      for (const item of msg.result.content) {
        if (item.type === "text") texts.push(item.text);
      }
    }
    return isChromeError(texts.join(" "));
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
  let state = "pending";
  let buffer = [];
  let partial = "";
  let relaunching = false;
  let launchError = null;
  const session = createMcpSession(buildMcpArgs(config, localBrowserUrl(port)), config,
    line => state === "ready" && responseHasStaleStateError(line));

  function sendMcpError(line, message) {
    try { session.fail(JSON.parse(line), message); } catch {}
  }

  async function launch() {
    state = "launching";
    try {
      await ensureChrome(config, port);
      state = "ready";
      for (const line of buffer.splice(0)) session.write(line);
    } catch (error) {
      launchError = error.message;
      state = "failed";
      for (const line of buffer.splice(0)) sendMcpError(line, launchError);
    }
  }

  async function relaunchChrome() {
    if (relaunching) return;
    relaunching = true;
    try { deleteLock(); await ensureChrome(config, port); }
    catch (error) { process.stderr.write(`[my-agent-browser] Chrome relaunch failed: ${error.message}\n`); }
    finally { relaunching = false; }
  }

  function handleLine(line) {
    if (state === "ready") { session.write(line); return; }
    if (state === "failed") { sendMcpError(line, launchError); return; }
    if (state === "launching") { buffer.push(line); return; }
    let request;
    try { request = JSON.parse(line); } catch { session.write(line); return; }
    if (request.method === "tools/call") { buffer.push(line); launch(); }
    else session.write(line);
  }

  process.stdin.on("data", chunk => {
    partial += chunk.toString();
    const lines = partial.split("\n"); partial = lines.pop();
    for (const line of lines) handleLine(line);
  });
  process.stdin.on("end", () => {
    session.end(); cleanup(); setTimeout(() => process.exit(0), 500);
  });
  session.on("line", line => {
    if (state === "ready" && responseHasChromeError(line)) {
      probePort(port, 1500).then(alive => {
        if (alive) { process.stdout.write(line + "\n"); return; }
        relaunchChrome();
        try {
          const message = JSON.parse(line);
          delete message.error;
          message.result = { isError: true, content: [{ type: "text", text: "Chrome was closed or crashed and is being relaunched. Refresh page IDs, navigate again, and verify any previous mutation before retrying." }] };
          process.stdout.write(JSON.stringify(message) + "\n");
        } catch { process.stdout.write(line + "\n"); }
      });
    } else process.stdout.write(line + "\n");
  });
  return session;
}

// --- Parent heartbeat (detect orphaned state) ---

function setupParentHeartbeat(intervalMs = 5000) {
  const originalPpid = process.ppid;
  if (!originalPpid || originalPpid === 1) return;

  const timer = setInterval(() => {
    const parentGone = process.platform === "win32"
      ? !isProcessAlive(originalPpid)
      : (process.ppid === 1 || process.ppid !== originalPpid);

    if (parentGone) {
      process.stderr.write(`[my-agent-browser] parent (PID ${originalPpid}) gone, exiting.\n`);
      clearInterval(timer);
      cleanup();
      process.exit(0);
    }
  }, intervalMs);

  timer.unref();
}

// --- Startup orphan cleanup (Unix only) ---

function cleanupOrphanProcesses(port) {
  if (process.platform === "win32") return;
  try {
    const result = execFileSync("ps", ["-eo", "pid,ppid,args"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const targetPattern = `--browserUrl=http://127.0.0.1:${port}`;
    for (const line of result.split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 3) continue;
      const pid = parseInt(parts[0], 10);
      const ppid = parseInt(parts[1], 10);
      const cmd = parts.slice(2).join(" ");
      if (ppid === 1 && cmd.includes("chrome-devtools-mcp") && cmd.includes(targetPattern)) {
        if (pid === process.pid) continue;
        process.stderr.write(`[my-agent-browser] killing orphan chrome-devtools-mcp (PID ${pid})\n`);
        try { process.kill(pid, "SIGTERM"); } catch {}
      }
    }
  } catch {}
}

function printDoctor() {
  const report = { version: VERSION, node: process.version, nodePath: process.execPath,
    scriptPath: __filename, configPath: configFile, configExists: fs.existsSync(configFile),
    chromePath: findChrome(), mcpPath: findMcpBin(), expectedMcpVersion: MCP_VERSION, capabilities: ["pageId-routing", "mcp-reinitialize", "no-tool-replay", "stealth-evaluate"] };
  report.mcpVersion = findMcpVersion(report.mcpPath);
  report.mcpMatchesTestedVersion = report.mcpVersion === MCP_VERSION;
  try {
    const dev = path.resolve(__dirname, "..", ".config.json");
    const actual = fs.existsSync(dev) ? dev : configFile;
    report.configPath = actual;
    report.configExists = fs.existsSync(actual);
    const cfg = report.configExists ? JSON.parse(fs.readFileSync(actual, "utf8")) : {};
    report.mode = cfg.browser?.browserUrl ? "direct" : cfg.browser?.lazyStart === false ? "eager" : "lazy";
  } catch (error) { report.configError = error.message; process.exitCode = 1; }
  console.log(JSON.stringify(report, null, process.argv.includes("--json") ? undefined : 2));
}

// --- Main ---

async function main() {
  if (process.argv.includes("--version")) { console.log(VERSION); return; }
  if (process.argv.includes("--doctor")) { printDoctor(); return; }
  const config = loadConfig();
  const b = config.browser || {};
  const port = b.debuggingPort || DEFAULT_PORT;
  const lazyStart = b.lazyStart !== false;

  // Direct connection mode
  if (b.browserUrl) {
    process.stderr.write(`[my-agent-browser] direct mode: connecting to ${b.browserUrl}\n`);
    const args = buildMcpArgs(config, b.browserUrl);
    const child = startMcpProxied(args, config);
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

  // Orphan cleanup on startup
  cleanupOrphanProcesses(port);

  // Parent heartbeat — exit if parent dies
  setupParentHeartbeat(5000);

  let child;

  if (lazyStart) {
    process.stderr.write(`[my-agent-browser] lazy mode: Chrome will start on first tool call\n`);
    child = startLazy(config, port);
  } else {
    await ensureChrome(config, port);
    const mcpArgs = buildMcpArgs(config, localBrowserUrl(port));
    child = startMcpProxied(mcpArgs, config);
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

// Only run the server when executed directly, so the pure helpers above
// (buildChromeArgs / buildMcpArgs) can be require()'d from tests.
if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[my-agent-browser] FATAL: ${err.message}\n`);
    process.stderr.write(`[my-agent-browser] The MCP server cannot start. Fix the issue above and restart your agent session.\n`);
    process.exit(1);
  });
}

module.exports = {
  buildChromeArgs,
  buildMcpArgs,
  localBrowserUrl,
  expandHome,
  stealthConfig,
  wrapStealthFunction,
  rewriteClientLine,
  rewriteNewPageBackground,
  rewriteClientRequest,
};
