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
  if (!fs.existsSync(configFile)) return [];

  const d = JSON.parse(fs.readFileSync(configFile, "utf-8"));
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

if (bin) {
  const child = spawn(bin, args, { stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 1));
} else {
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const child = spawn(npx, ["-y", "chrome-devtools-mcp@latest", ...args], {
    stdio: "inherit",
  });
  child.on("exit", (code) => process.exit(code ?? 1));
}
