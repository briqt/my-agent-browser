"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const pkg = require("../package.json");

const SKILL_NAME = "my-agent-browser";
const VERSION = pkg.version;
const TESTED_MCP_VERSION = pkg.dependencies["chrome-devtools-mcp"];
const DEFAULT_PORT = 39813;
const DEFAULT_IDLE_TIMEOUT = "30m";
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

function getHomeDir(env = process.env) {
  const custom = env.MY_AGENT_BROWSER_HOME && env.MY_AGENT_BROWSER_HOME.trim();
  if (custom) return path.resolve(expandHome(custom));
  return path.join(os.homedir(), ".config", "agent-skills", SKILL_NAME);
}

function expandHome(p) {
  if (typeof p !== "string") return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

function homeHash(env = process.env) {
  return createHash("sha256").update(getHomeDir(env)).digest("hex").slice(0, 12);
}

function getSocketPath(env = process.env) {
  if (env.MY_AGENT_BROWSER_SOCKET && env.MY_AGENT_BROWSER_SOCKET.trim()) {
    return env.MY_AGENT_BROWSER_SOCKET.trim();
  }
  const homeDir = getHomeDir(env);
  const hash = homeHash(env);
  if (process.platform === "win32") {
    const user = (env.USERNAME || env.USER || "user").replace(/[^A-Za-z0-9._-]/g, "_");
    return `\\\\.\\pipe\\mab-${user}-${hash}`;
  }
  // Prefer placing socket inside private homeDir when within Unix sun_path limit (<100 bytes).
  const inHome = path.join(homeDir, "mab.sock");
  if (Buffer.byteLength(inHome, "utf8") < 100) {
    return inHome;
  }
  const uid = typeof process.getuid === "function" ? process.getuid() : "u";
  const fallbackDir = `/tmp/mab-${uid}`;
  try {
    fs.mkdirSync(fallbackDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(fallbackDir, 0o700);
  } catch {}
  return path.join(fallbackDir, `mab-${hash}.sock`);
}

function getDaemonLockPath(env = process.env) {
  return path.join(getHomeDir(env), "daemon.lock");
}

function getDaemonStatePath(env = process.env) {
  return path.join(getHomeDir(env), "daemon.state.json");
}

function getLegacyLockPath(env = process.env) {
  return path.join(getHomeDir(env), "browser.lock");
}

function validateOwnerName(owner) {
  if (owner === undefined || owner === null || owner === "") return "";
  if (typeof owner !== "string") throw new Error("owner must be a string");
  const trimmed = owner.trim();
  if (!trimmed) return "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,63}$/.test(trimmed)) {
    throw new Error("owner must be 1-64 chars matching [A-Za-z0-9._:@/-] and start with an alphanumeric character");
  }
  return trimmed;
}

function resolveOwner(explicitOwner, env = process.env) {
  if (explicitOwner !== undefined && explicitOwner !== null) {
    return validateOwnerName(explicitOwner);
  }
  const fromEnv = env.MY_AGENT_BROWSER_OWNER;
  if (fromEnv !== undefined && fromEnv.trim() !== "") {
    return validateOwnerName(fromEnv);
  }
  return "";
}

function formatDuration(ms) {
  if (ms === null || ms === undefined || ms < 0) return "unknown";
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (totalMin < 60) return sec > 0 ? `${totalMin}m ${sec}s` : `${totalMin}m`;
  const hours = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return min > 0 ? `${hours}h ${min}m` : `${hours}h`;
}

module.exports = {
  SKILL_NAME,
  VERSION,
  TESTED_MCP_VERSION,
  DEFAULT_PORT,
  DEFAULT_IDLE_TIMEOUT,
  DEFAULT_IDLE_TIMEOUT_MS,
  getHomeDir,
  expandHome,
  getSocketPath,
  getDaemonLockPath,
  getDaemonStatePath,
  getLegacyLockPath,
  validateOwnerName,
  resolveOwner,
  formatDuration,
};
