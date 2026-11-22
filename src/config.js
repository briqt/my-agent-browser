"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { getHomeDir, DEFAULT_IDLE_TIMEOUT, DEFAULT_IDLE_TIMEOUT_MS } = require("./protocol.js");

const DEFAULT_EXTRA_ARGS = [
  "--disable-dev-shm-usage",
  "--disable-background-networking",
  "--disable-sync",
  "--disable-translate",
  "--metrics-recording-only",
  "--mute-audio",
  "--disable-hang-monitor",
  "--disable-prompt-on-repost",
  "--disable-client-side-phishing-detection",
  "--disable-component-update",
  "--disable-domain-reliability",
  "--disable-features=TranslateUI",
];

const DEFAULT_CONFIG = {
  browser: {
    userDataDir: "~/.config/agent-skills/my-agent-browser/user-data",
    headless: true,
    proxy: "",
    viewport: "1280x720",
    display: "",
    debuggingPort: 39813,
    extraArgs: [...DEFAULT_EXTRA_ARGS],
    browserUrl: "",
    idleTimeout: DEFAULT_IDLE_TIMEOUT,
  },
  stealth: {
    evaluateScript: true,
    sourceUrl: "eval.js",
  },
  disable_update_check: false,
};

const CONFIG_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "my-agent-browser config",
  type: "object",
  properties: {
    browser: {
      type: "object",
      description: "Chrome browser launch and lifecycle settings",
      properties: {
        userDataDir: {
          type: "string",
          description: "Chrome user-data directory path (supports ~ expansion)",
        },
        headless: {
          type: "boolean",
          description: "Run Chrome in headless mode",
        },
        proxy: {
          type: "string",
          description: "Proxy server URL (e.g. http://127.0.0.1:3067)",
        },
        viewport: {
          type: "string",
          description: "Window size: \"WIDTHxHEIGHT\" (e.g. 1280x720), \"maximized\" (1920x1080 in headless), or empty for Chrome default",
        },
        display: {
          type: "string",
          description: "Linux only: fallback DISPLAY value when unset (e.g. \":0\")",
        },
        debuggingPort: {
          type: "integer",
          description: "Chrome remote debugging port",
          default: 39813,
        },
        extraArgs: {
          type: "array",
          items: { type: "string" },
          description: "Extra command-line flags passed to Chrome",
        },
        browserUrl: {
          type: "string",
          description: "Existing Chrome CDP HTTP or WebSocket URL (skips launching or closing Chrome)",
        },
        idleTimeout: {
          type: ["string", "integer"],
          description: "Auto-close idle browser/daemon after duration (e.g. \"30m\", \"1h\", \"300s\") or \"never\" / 0",
          default: "30m",
        },
      },
    },
    stealth: {
      type: "object",
      description: "Anti-detection settings",
      properties: {
        evaluateScript: {
          type: "boolean",
          description: "Rewrite inline evaluate_script functions so stack traces hide pptr: and local paths",
          default: true,
        },
        sourceUrl: {
          type: "string",
          description: "Source URL token shown in rewritten evaluate_script stack traces",
          default: "eval.js",
        },
      },
    },
    disable_update_check: {
      type: "boolean",
      default: false,
      description: "Disable CLI update checks and cached update/announcement reminders",
    },
  },
};

function parseIdleTimeout(value) {
  if (value === undefined) return DEFAULT_IDLE_TIMEOUT_MS;
  if (value === 0) return 0;
  if (typeof value === "number") {
    throw new Error('config.browser.idleTimeout must be 0 or a string with unit (e.g. "30m", "1h", "60s", "never")');
  }
  if (typeof value !== "string") {
    throw new Error('config.browser.idleTimeout must be a string (e.g. "30m", "never") or 0');
  }
  const raw = value.trim().toLowerCase();
  if (raw === "never" || raw === "off" || raw === "0") return 0;
  const match = /^([1-9]\d*)(ms|s|m|h)$/.exec(raw);
  if (!match) {
    throw new Error('config.browser.idleTimeout must match "<number><ms|s|m|h>" (e.g. "30m", "1h") or "never"');
  }
  const amount = Number(match[1]);
  const unit = match[2];
  const factor = unit === "ms" ? 1 : unit === "s" ? 1000 : unit === "m" ? 60_000 : 3_600_000;
  const ms = amount * factor;
  if (!Number.isSafeInteger(ms) || ms > 2_147_483_647) {
    throw new Error('config.browser.idleTimeout exceeds maximum timer duration (~24 days); use "never" instead');
  }
  return ms;
}

function matchesType(value, expected) {
  if (Array.isArray(expected)) return expected.some((t) => matchesType(value, t));
  if (expected === "object") return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  if (expected === "array") return Array.isArray(value);
  if (expected === "integer") return Number.isInteger(value);
  return typeof value === expected;
}

function validateConfig(config) {
  function visit(value, rule, field) {
    if (!matchesType(value, rule.type)) {
      const label = Array.isArray(rule.type) ? rule.type.join(" or ") : rule.type;
      throw new Error(`${field} must be ${label}`);
    }
    if (rule.type === "object") {
      for (const [key, child] of Object.entries(rule.properties || {})) {
        if (Object.hasOwn(value, key)) visit(value[key], child, `${field}.${key}`);
      }
    }
    if (rule.type === "array") {
      value.forEach((item, index) => visit(item, rule.items, `${field}[${index}]`));
    }
  }
  visit(config, CONFIG_SCHEMA, "config");
  if (config.browser && Object.hasOwn(config.browser, "idleTimeout")) {
    parseIdleTimeout(config.browser.idleTimeout);
  }
  if (config.browser && Object.hasOwn(config.browser, "debuggingPort")) {
    const p = config.browser.debuggingPort;
    if (p < 1 || p > 65535) throw new Error("config.browser.debuggingPort must be between 1 and 65535");
  }
  return config;
}

function resolveEffectiveConfig(userConfig = {}) {
  const b = userConfig.browser || {};
  const s = userConfig.stealth || {};
  return {
    browser: {
      userDataDir: b.userDataDir ?? DEFAULT_CONFIG.browser.userDataDir,
      headless: b.headless ?? DEFAULT_CONFIG.browser.headless,
      proxy: b.proxy ?? DEFAULT_CONFIG.browser.proxy,
      viewport: b.viewport !== undefined ? b.viewport : DEFAULT_CONFIG.browser.viewport,
      display: b.display ?? DEFAULT_CONFIG.browser.display,
      debuggingPort: b.debuggingPort ?? DEFAULT_CONFIG.browser.debuggingPort,
      extraArgs: Array.isArray(b.extraArgs) ? [...b.extraArgs] : [...DEFAULT_EXTRA_ARGS],
      browserUrl: b.browserUrl ?? DEFAULT_CONFIG.browser.browserUrl,
      idleTimeout: b.idleTimeout !== undefined ? b.idleTimeout : DEFAULT_CONFIG.browser.idleTimeout,
    },
    stealth: {
      evaluateScript: s.evaluateScript ?? DEFAULT_CONFIG.stealth.evaluateScript,
      sourceUrl: s.sourceUrl ?? DEFAULT_CONFIG.stealth.sourceUrl,
    },
    disable_update_check: userConfig.disable_update_check ?? DEFAULT_CONFIG.disable_update_check,
  };
}

function getConfigCandidates({ env = process.env, devConfig = false, repoSkillDir } = {}) {
  const userConfig = path.join(getHomeDir(env), "config.json");
  if (!devConfig) return [userConfig];
  const skillDir = repoSkillDir || path.resolve(__dirname, "..", "skills", "my-agent-browser");
  return [path.join(skillDir, ".config.json"), userConfig];
}

function loadConfig({ env = process.env, devConfig = false, repoSkillDir } = {}) {
  const candidates = getConfigCandidates({ env, devConfig, repoSkillDir });
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      let parsed;
      try {
        parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch {
        throw new Error(
          `Invalid config ${file}: invalid JSON.\n` +
          `Fix: edit "${file}" or recreate defaults after backing it up with: my-agent-browser config init`
        );
      }
      try {
        validateConfig(parsed);
      } catch (err) {
        throw new Error(
          `Invalid config ${file}: ${err.message}.\n` +
          `Fix: edit "${file}" to match schema, then run: my-agent-browser config validate`
        );
      }
      return { config: parsed, configPath: file, exists: true, searched: candidates };
    }
  }
  return { config: {}, configPath: candidates[candidates.length - 1], exists: false, searched: candidates };
}

function initConfig({ env = process.env } = {}) {
  const dir = getHomeDir(env);
  const file = path.join(dir, "config.json");
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.writeFileSync(file, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    return { created: true, path: file };
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    return { created: false, path: file };
  }
}

module.exports = {
  DEFAULT_EXTRA_ARGS,
  DEFAULT_CONFIG,
  CONFIG_SCHEMA,
  parseIdleTimeout,
  validateConfig,
  resolveEffectiveConfig,
  getConfigCandidates,
  loadConfig,
  initConfig,
};
