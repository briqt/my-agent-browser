#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync, spawn } = require("child_process");

const configDir =
  process.env.MY_AGENT_BROWSER_HOME || path.join(os.homedir(), ".my-agent-browser");
const configFile = path.join(configDir, "config.json");

function expandHome(p) {
  if (p.startsWith("~/") || p === "~") {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

function buildArgs() {
  if (!fs.existsSync(configFile)) {
    process.stderr.write(`[my-agent-browser] config not found: ${configFile} — using defaults\n`);
    return [];
  }

  let d;
  try {
    d = JSON.parse(fs.readFileSync(configFile, "utf-8"));
  } catch (e) {
    process.stderr.write(`[my-agent-browser] failed to parse ${configFile}: ${e.message}\n`);
    process.exit(1);
  }

  const b = d.browser || {};
  const m = d.mcp || {};
  const args = [];

  if (b.browserUrl) args.push(`--browser-url=${b.browserUrl}`);
  if (b.userDataDir) args.push(`--userDataDir=${expandHome(b.userDataDir)}`);
  if (b.headless) args.push("--headless");
  if (b.proxy) args.push(`--proxyServer=${b.proxy}`);
  if (b.viewport) args.push(`--viewport=${b.viewport}`);

  for (const arg of b.extraArgs || []) args.push(`--chromeArg=${arg}`);
  for (const f of m.features || []) args.push(f);
  for (const f of m.flags || []) args.push(f);

  return args;
}

function findBin() {
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

const args = buildArgs();
const bin = findBin();

let child;
if (bin) {
  child = spawn(bin, args, { stdio: "inherit" });
} else {
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  child = spawn(npx, ["-y", "chrome-devtools-mcp@^0.25.0", ...args], {
    stdio: "inherit",
  });
}

child.on("error", (err) => {
  process.stderr.write(`[my-agent-browser] spawn error: ${err.message}\n`);
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 1));

for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(sig, () => child.kill(sig));
}
