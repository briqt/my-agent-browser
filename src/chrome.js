"use strict";

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");
const { execFileSync, spawn } = require("node:child_process");
const { expandHome, getHomeDir } = require("./protocol.js");
const { DEFAULT_EXTRA_ARGS } = require("./config.js");

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

function probePort(port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get(
      {
        hostname: "127.0.0.1",
        port,
        path: "/json/version",
        timeout: timeoutMs,
        createConnection: () => net.connect({ host: "127.0.0.1", port }),
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          resolve(false);
          return;
        }
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(body);
            resolve(parsed && parsed.Browser ? parsed : false);
          } catch {
            resolve(false);
          }
        });
      }
    );
    req.on("error", () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForPort(port, maxWaitMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (await probePort(port, 1000)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function findChrome() {
  const pathNames =
    process.platform === "win32"
      ? ["chrome.exe", "google-chrome.exe", "msedge.exe", "chromium.exe", "brave.exe"]
      : process.platform === "darwin"
        ? ["google-chrome", "chromium", "microsoft-edge"]
        : [
            "google-chrome",
            "google-chrome-stable",
            "chromium-browser",
            "chromium",
            "microsoft-edge-stable",
            "microsoft-edge",
            "brave-browser",
          ];

  for (const name of pathNames) {
    try {
      const cmd = process.platform === "win32" ? "where" : "which";
      const result = execFileSync(cmd, [name], {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      if (result) return result.split(/\r?\n/)[0];
    } catch {}
  }

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

function buildChromeArgs(b = {}, port, userDataDir) {
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-crash-restore-bubble",
  ];

  if (b.headless !== false) args.push("--headless=new");
  if (b.proxy) args.push(`--proxy-server=${b.proxy}`);
  const viewport = b.viewport !== undefined ? b.viewport : "1280x720";
  if (viewport === "maximized") {
    if (b.headless !== false) {
      args.push("--window-size=1920,1080");
    } else {
      args.push("--start-maximized");
    }
  } else if (viewport) {
    const [w, h] = String(viewport).split("x");
    args.push(`--window-size=${w},${h}`);
  }
  const extraArgs = Array.isArray(b.extraArgs) ? b.extraArgs : DEFAULT_EXTRA_ARGS;
  for (const arg of extraArgs) args.push(arg);

  // Open a clean about:blank tab instead of browser-internal chrome://newtab or edge://newtab
  // targets, which upstream McpContext filters out and disposes mid-initialization.
  if (!extraArgs.some((arg) => typeof arg === "string" && arg && !arg.startsWith("-"))) {
    args.push("about:blank");
  }

  return args;
}

function buildChromeEnv(browserConfig = {}, baseEnv = process.env) {
  const env = { ...baseEnv };
  if (process.platform !== "linux") return env;

  if (!env.DISPLAY) {
    if (fs.existsSync("/tmp/.X11-unix/X0")) {
      env.DISPLAY = ":0";
    } else if (browserConfig.display) {
      env.DISPLAY = browserConfig.display;
    }
  }
  if (!env.WAYLAND_DISPLAY) {
    if (fs.existsSync("/run/user/" + (process.getuid?.() || 1000) + "/wayland-0")) {
      env.WAYLAND_DISPLAY = "wayland-0";
    }
  }
  return env;
}

function launchChrome(config, port, env = process.env) {
  const b = (config && config.browser) || {};
  const homeDir = getHomeDir(env);
  const userDataDir = b.userDataDir ? expandHome(b.userDataDir) : path.join(homeDir, "user-data");
  const chromePath = findChrome();
  if (!chromePath) {
    const searchedPaths =
      process.platform === "darwin"
        ? "Google Chrome, Microsoft Edge, Chromium, Brave, Arc in /Applications and PATH"
        : process.platform === "win32"
          ? "Chrome, Edge, Brave, Chromium in Program Files, LocalAppData, and PATH"
          : "google-chrome, chromium, microsoft-edge, brave-browser via PATH and /opt";
    throw new Error(
      `Chrome/Chromium not found. Searched: ${searchedPaths}. ` +
      `Fix: (1) Install Chrome/Edge/Chromium, (2) add it to PATH, or ` +
      `(3) set "browserUrl" in "${path.join(homeDir, "config.json")}" to connect to an existing browser.`
    );
  }

  fs.mkdirSync(userDataDir, { recursive: true });
  for (const lockName of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
    try { fs.unlinkSync(path.join(userDataDir, lockName)); } catch {}
  }

  const args = buildChromeArgs(b, port, userDataDir);
  const childEnv = buildChromeEnv(b, env);
  const child = spawn(chromePath, args, {
    detached: true,
    stdio: "ignore",
    env: childEnv,
    windowsHide: Boolean(b.headless !== false),
  });
  child.unref();
  return { pid: child.pid, chromePath, userDataDir, args };
}

function resolveBinFromPackageJson(manifestPath, source) {
  const pkg = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (pkg.name !== "chrome-devtools-mcp") return null;
  const relBin =
    typeof pkg.bin === "string"
      ? pkg.bin
      : pkg.bin && typeof pkg.bin === "object"
        ? pkg.bin["chrome-devtools-mcp"]
        : null;
  if (!relBin) return null;
  const binPath = path.resolve(path.dirname(manifestPath), relBin);
  if (!fs.existsSync(binPath)) return null;
  return { binPath, version: pkg.version || null, manifestPath, source };
}

function resolveMcpPackageFromCommandPath(commandPath) {
  if (!commandPath) return null;
  const shimDir = path.dirname(commandPath);
  // Windows global npm prefix: <prefix>/chrome-devtools-mcp(.cmd) -> <prefix>/node_modules/chrome-devtools-mcp/package.json
  const candidates = [
    path.join(shimDir, "node_modules", "chrome-devtools-mcp", "package.json"),
    path.join(shimDir, "..", "lib", "node_modules", "chrome-devtools-mcp", "package.json"),
  ];
  for (const manifest of candidates) {
    if (fs.existsSync(manifest)) {
      try {
        const resolved = resolveBinFromPackageJson(manifest, "path");
        if (resolved) return resolved;
      } catch {}
    }
  }
  try {
    let current = path.dirname(fs.realpathSync(commandPath));
    for (let i = 0; i < 8; i++) {
      const manifest = path.join(current, "package.json");
      if (fs.existsSync(manifest)) {
        const resolved = resolveBinFromPackageJson(manifest, "path");
        if (resolved) return resolved;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  } catch {}
  return null;
}

function resolveMcpPackage({ preferBundled = true, env = process.env } = {}) {
  if (preferBundled) {
    try {
      const manifest = require.resolve("chrome-devtools-mcp/package.json");
      const resolved = resolveBinFromPackageJson(manifest, "bundled");
      if (resolved) return resolved;
    } catch {}
  }

  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    const out = execFileSync(cmd, ["chrome-devtools-mcp"], {
      encoding: "utf8",
      env,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    for (const line of out.split(/\r?\n/).filter(Boolean)) {
      const resolved = resolveMcpPackageFromCommandPath(line);
      if (resolved) return resolved;
    }
  } catch {}

  return null;
}

function localBrowserUrl(port) {
  return `http://127.0.0.1:${port}`;
}

function hasFlagMatching(flags, prefixes) {
  return flags.some((flag) => prefixes.some((p) => flag === p || flag.startsWith(`${p}=`)));
}

function buildMcpArgs(config, browserUrl, { structuredContent = true } = {}) {
  const m = (config && config.mcp) || {};
  const userFlags = [...(m.features || []), ...(m.flags || [])];
  const args = [`--browserUrl=${browserUrl}`];

  if (!hasFlagMatching(userFlags, ["--usageStatistics", "--usage-statistics", "--no-usageStatistics", "--no-usage-statistics"])) {
    args.push("--no-usage-statistics");
  }
  if (!hasFlagMatching(userFlags, ["--performanceCrux", "--performance-crux", "--no-performanceCrux", "--no-performance-crux"])) {
    args.push("--no-performance-crux");
  }
  if (
    structuredContent &&
    !hasFlagMatching(userFlags, [
      "--experimentalStructuredContent",
      "--experimental-structured-content",
      "--no-experimentalStructuredContent",
      "--no-experimental-structured-content",
    ])
  ) {
    args.push("--experimental-structured-content");
  }
  if (
    !hasFlagMatching(userFlags, [
      "--workspace",
      "--filesystemRoot",
      "--filesystem-root",
      "--allowUnrestrictedPaths",
      "--allow-unrestricted-paths",
      "--no-allowUnrestrictedPaths",
      "--no-allow-unrestricted-paths",
    ])
  ) {
    args.push("--allow-unrestricted-paths");
  }

  for (const f of userFlags) args.push(f);
  return args;
}

function buildMcpEnv(baseEnv = process.env) {
  const loopback = ["127.0.0.1", "localhost"];
  const existing = baseEnv.no_proxy || baseEnv.NO_PROXY || "";
  const entries = existing ? existing.split(",").map((s) => s.trim()).filter(Boolean) : [];
  for (const addr of loopback) {
    if (!entries.includes(addr)) entries.push(addr);
  }
  const merged = entries.join(",");
  const env = {
    ...baseEnv,
    no_proxy: merged,
    NO_PROXY: merged,
    CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: "1",
    CHROME_DEVTOOLS_MCP_NO_CONFIG_DISCOVERY: "1",
  };
  return env;
}

module.exports = {
  isProcessAlive,
  probePort,
  waitForPort,
  findChrome,
  buildChromeArgs,
  buildChromeEnv,
  launchChrome,
  resolveBinFromPackageJson,
  resolveMcpPackageFromCommandPath,
  resolveMcpPackage,
  localBrowserUrl,
  buildMcpArgs,
  buildMcpEnv,
};
