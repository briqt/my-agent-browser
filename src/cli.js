#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  VERSION,
  TESTED_MCP_VERSION,
  getHomeDir,
  expandHome,
  getSocketPath,
  getLegacyLockPath,
  resolveOwner,
  formatDuration,
} = require("./protocol.js");
const { loadConfig, initConfig, parseIdleTimeout } = require("./config.js");
const { findChrome, resolveMcpPackage } = require("./chrome.js");
const {
  DEFAULT_RPC_TIMEOUT_MS,
  sendRawRequest,
  inspectDaemon,
  ensureDaemon,
  requestDaemon,
  waitForDaemonExit,
} = require("./client.js");
const { checkUpdate, isUpdateDisabled } = require("./update-check.js");

const AUTO_UPDATE_COMMANDS = new Set(["start", "status", "pages", "list_pages", "list-pages"]);
const LIFECYCLE_COMMANDS = new Set([
  "start",
  "stop",
  "restart",
  "status",
  "doctor",
  "config",
  "check-update",
  "tools",
  "claim",
  "release",
]);

const ALIAS_TO_TOOL = {
  pages: "list_pages",
  list_pages: "list_pages",
  open: "new_page",
  new_page: "new_page",
  goto: "navigate_page",
  navigate_page: "navigate_page",
  reload: "navigate_page",
  back: "navigate_page",
  forward: "navigate_page",
  select_page: "select_page",
  close: "close_page",
  close_page: "close_page",
  snap: "take_snapshot",
  snapshot: "take_snapshot",
  take_snapshot: "take_snapshot",
  shot: "take_screenshot",
  screenshot: "take_screenshot",
  take_screenshot: "take_screenshot",
  click: "click",
  fill: "fill",
  fill_form: "fill_form",
  hover: "hover",
  drag: "drag",
  press: "press_key",
  press_key: "press_key",
  type: "type_text",
  type_text: "type_text",
  upload: "upload_file",
  upload_file: "upload_file",
  dialog: "handle_dialog",
  handle_dialog: "handle_dialog",
  wait_for: "wait_for",
  eval: "evaluate_script",
  evaluate_script: "evaluate_script",
  batch: "run_actions",
  run_actions: "run_actions",
  console: "list_console_messages",
  list_console_messages: "list_console_messages",
  network: "list_network_requests",
  list_network_requests: "list_network_requests",
  logpoints: "set_logpoints",
  set_logpoints: "set_logpoints",
};

const PATH_FIELDS = [
  "filePath",
  "baseFilePath",
  "currentFilePath",
  "snapshotFilePath",
  "outputDirPath",
  "requestFilePath",
  "responseFilePath",
];

function assertAllowedOptions(options, allowed, cmdName) {
  for (const key of Object.keys(options)) {
    if (!allowed.includes(key)) {
      throw new Error(`Unknown option '--${key}' for '${cmdName}'. Run 'my-agent-browser ${cmdName} --help'.`);
    }
  }
}

function toCamelCase(flagName) {
  return flagName.replace(/-([a-z0-9])/g, (_, ch) => ch.toUpperCase());
}

function toSnakeCase(cmdName) {
  return cmdName.replace(/-/g, "_");
}

function resolveLocalPath(p) {
  if (typeof p !== "string" || !p) return p;
  return path.resolve(expandHome(p));
}

// Resolve relative / ~ file paths against the CLI caller's CWD before sending to the background daemon.
function normalizeToolPaths(toolName, args) {
  if (!args || typeof args !== "object") return args;
  const out = { ...args };
  for (const key of PATH_FIELDS) {
    if (typeof out[key] === "string") out[key] = resolveLocalPath(out[key]);
  }
  if (Array.isArray(out.filePaths)) {
    out.filePaths = out.filePaths.map((p) => (typeof p === "string" ? resolveLocalPath(p) : p));
  }
  if (toolName === "mock_network" && typeof out.body === "string") {
    out.body = resolveLocalPath(out.body);
  }
  if (toolName === "install_extension" && typeof out.path === "string") {
    out.path = resolveLocalPath(out.path);
  }
  if (toolName === "evaluate_script" && typeof out.sourcePath === "string" && !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(out.sourcePath)) {
    out.sourcePath = resolveLocalPath(out.sourcePath);
  }
  if (toolName === "install_pwa" && typeof out.installUrlOrBundleUrl === "string" && !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(out.installUrlOrBundleUrl)) {
    out.installUrlOrBundleUrl = resolveLocalPath(out.installUrlOrBundleUrl);
  }
  return out;
}

function parseGlobalAndCommandArgs(rawArgv) {
  const globals = {
    help: false,
    version: false,
    json: false,
    raw: false,
    force: false,
    noUpdateCheck: false,
    devConfig: false,
    owner: undefined,
    pageId: undefined,
    rpcTimeoutMs: undefined,
  };
  const rest = [];

  for (let i = 0; i < rawArgv.length; i++) {
    const token = rawArgv[i];
    if (token === "--") {
      if (rest.length > 0) rest.push("--", ...rawArgv.slice(i + 1));
      else rest.push(...rawArgv.slice(i + 1));
      break;
    }
    if (token === "-h" || token === "--help") { globals.help = true; continue; }
    if (token === "-v" || token === "--version") { globals.version = true; continue; }
    if (token === "--json") { globals.json = true; continue; }
    if (token === "--raw") { globals.raw = true; continue; }
    if (token === "--force" || token === "-f") { globals.force = true; continue; }
    if (token === "--no-update-check") { globals.noUpdateCheck = true; continue; }
    if (token === "--dev-config") { globals.devConfig = true; continue; }
    if (token === "--owner" || token.startsWith("--owner=")) {
      const val = token.includes("=") ? token.slice("--owner=".length) : rawArgv[++i];
      if (val === undefined) throw new Error("--owner requires a value");
      globals.owner = val;
      continue;
    }
    if (
      token === "--page" || token === "--page-id" || token === "--pageId" ||
      token.startsWith("--page=") || token.startsWith("--page-id=") || token.startsWith("--pageId=")
    ) {
      const val = token.includes("=") ? token.slice(token.indexOf("=") + 1) : rawArgv[++i];
      if (val === undefined) throw new Error(`${token.split("=")[0]} requires a numeric pageId`);
      const num = Number(val);
      if (!Number.isSafeInteger(num) || num < 0) throw new Error(`pageId must be a nonnegative integer, got: ${val}`);
      globals.pageId = num;
      continue;
    }
    if (token === "--rpc-timeout-ms" || token.startsWith("--rpc-timeout-ms=")) {
      const val = token.includes("=") ? token.slice("--rpc-timeout-ms=".length) : rawArgv[++i];
      const num = Number(val);
      if (!Number.isSafeInteger(num) || num < 100) throw new Error("--rpc-timeout-ms must be an integer >= 100");
      globals.rpcTimeoutMs = num;
      continue;
    }
    rest.push(token);
  }
  return { globals, command: rest[0] || null, args: rest.slice(1) };
}

function parseSubcommandTokens(tokens, booleanFlags = new Set(), arrayFlags = new Set()) {
  const positionals = [];
  const options = {};

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "--") {
      positionals.push(...tokens.slice(i + 1));
      break;
    }
    if (token === "-o") {
      const val = tokens[++i];
      if (val === undefined) throw new Error("-o requires a file path");
      options.filePath = val;
      continue;
    }
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const eqIdx = token.indexOf("=");
    const rawKey = eqIdx === -1 ? token.slice(2) : token.slice(2, eqIdx);
    const hasInline = eqIdx !== -1;
    const inlineVal = hasInline ? token.slice(eqIdx + 1) : undefined;

    if (rawKey.startsWith("no-") && !hasInline) {
      const baseKey = toCamelCase(rawKey.slice(3));
      options[baseKey] = false;
      continue;
    }

    const key = toCamelCase(rawKey);
    const isBool = booleanFlags.has(key) || booleanFlags.has(rawKey);
    const isArr = arrayFlags.has(key) || arrayFlags.has(rawKey);

    let val;
    if (hasInline) {
      val = inlineVal;
    } else if (isBool) {
      const next = tokens[i + 1];
      if (next === "true" || next === "false") {
        val = next === "true";
        i++;
      } else {
        val = true;
      }
    } else {
      if (i + 1 >= tokens.length) throw new Error(`Option --${rawKey} requires a value`);
      val = tokens[++i];
    }

    if (isArr) {
      if (!Array.isArray(options[key])) options[key] = [];
      options[key].push(val);
    } else {
      options[key] = val;
    }
  }
  return { positionals, options };
}

function parseStrictInt(value, flagName) {
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isSafeInteger(n)) throw new Error(`--${flagName} expects an integer, got: ${value}`);
  return n;
}

function parseStrictNumber(value, flagName) {
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || String(value).trim() === "") throw new Error(`--${flagName} expects a number, got: ${value}`);
  return n;
}

function coerceBySchema(value, propSchema, flagName) {
  if (value === undefined) return undefined;
  const type = propSchema?.type;
  if (type === "boolean") {
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    throw new Error(`--${flagName} expects boolean (true/false), got: ${value}`);
  }
  if (type === "number" || type === "integer") {
    if (typeof value === "number") return value;
    if (typeof value === "string" && value.trim() !== "") {
      const n = Number(value);
      if (Number.isFinite(n) && (type !== "integer" || Number.isInteger(n))) return n;
    }
    throw new Error(`--${flagName} expects ${type}, got: ${value}`);
  }
  if (type === "array") {
    const itemSchema = propSchema.items || { type: "string" };
    let arr;
    if (Array.isArray(value)) {
      if (value.length === 1 && typeof value[0] === "string" && value[0].trim().startsWith("[")) {
        try { arr = JSON.parse(value[0]); } catch { arr = value; }
      } else {
        arr = value;
      }
    } else if (typeof value === "string" && value.trim().startsWith("[")) {
      try { arr = JSON.parse(value); } catch { arr = [value]; }
    } else {
      arr = [value];
    }
    if (!Array.isArray(arr)) throw new Error(`--${flagName} expects an array`);
    const expectsObjectItem = itemSchema.type === "object" || itemSchema.oneOf?.some((s) => s.type === "object");
    return arr.map((item) => {
      if (expectsObjectItem) {
        return typeof item === "string" ? JSON.parse(item) : item;
      }
      return coerceBySchema(item, itemSchema, flagName);
    });
  }
  if (type === "object" || propSchema?.oneOf?.some((s) => s.type === "object")) {
    if (typeof value === "object" && value !== null) return value;
    try { return JSON.parse(String(value)); }
    catch { throw new Error(`--${flagName} expects a JSON object`); }
  }
  if (!type && typeof value !== "string") {
    return value;
  }
  return String(value);
}

function requirePageId(globals, positionals) {
  if (globals.pageId !== undefined) return globals.pageId;
  const raw = positionals.shift();
  if (raw === undefined) {
    throw new Error("pageId is required (e.g. 'my-agent-browser pages' to list numeric page IDs)");
  }
  if (!/^\d+$/.test(String(raw))) {
    throw new Error(`pageId must be a nonnegative integer (got ${JSON.stringify(raw)}; pass a number like 1)`);
  }
  return Number(raw);
}

function extractRawEvalValue(text) {
  if (typeof text !== "string") return "";
  const match = /Script ran on page and returned:\s*```(?:json|js|javascript)?\n([\s\S]*?)\n```/.exec(text);
  if (match) {
    const inner = match[1];
    try {
      const parsed = JSON.parse(inner);
      return typeof parsed === "string" ? parsed : JSON.stringify(parsed);
    } catch {
      return inner;
    }
  }
  return text;
}

function printMainHelp() {
  console.log(`my-agent-browser ${VERSION} — Stealth, managed Chrome DevTools CLI for AI agents

Usage:
  my-agent-browser <command> [args...] [options]

Core Browser Commands:
  open <url>                        Open a new tab (--owner <name>, --background, --foreground)
  pages                             List open tabs with numeric pageId, owner and idle time
  goto <pageId> <url>               Navigate tab to URL (also: reload / back / forward <pageId>)
  snap <pageId> [filePath]          Accessibility tree snapshot with uid refs (--verbose, -o <file>)
  shot <pageId> [filePath]          Take screenshot; saves to file (never dumps base64) (--full-page, --uid <uid>)
  click <pageId> <uid>              Click element (--dbl-click, --include-snapshot)
  fill <pageId> <uid> <value>       Clear field and type value
  fill-form <pageId> <uid=val...>   Fill multiple fields in one call (or --elements '<json>')
  hover <pageId> <uid>              Hover over element
  drag <pageId> <fromUid> <toUid>   Drag between elements
  press <pageId> <key>              Press key or combo (Enter, Tab, Escape, Control+A, ...)
  type <pageId> <text>              Type into focused element (--submit-key Enter)
  upload <pageId> <uid> <file...>   Upload file(s) through input/chooser element
  dialog <pageId> <accept|dismiss>  Handle alert/confirm/prompt (--prompt-text <text>)
  wait-for <pageId> <text...>       Wait until any text appears (--timeout <ms>, --visible)
  eval <pageId> <fn>                Run JS function in page (stealth stack hiding; --raw for pipes)
  batch <pageId> '<actions-json>'   Run up to 10 known stable steps (--snapshot final, --snapshot-file <f>)

DevTools & Native Ceiling (all 33+ upstream tools available directly):
  console <pageId>                  List console messages (--types error)
  network <pageId>                  List network requests (--resource-types fetch)
  logpoints <pageId> <spec...>      Set source-mapped logpoints (--clear to remove all)
  <any_upstream_tool> [args...]     Call any chrome-devtools-mcp tool directly (e.g. lighthouse_audit,
                                    emulate, performance_start_trace, take_heapsnapshot, mock_network)
  call <tool> --args-json '<json>'  Lossless raw JSON tool invocation
  tools [--json]                    List all currently enabled tools in the live engine

Daemon, Multi-Agent Ownership & Maintenance:
  status [--json]                   Inspect daemon, browser, idle timer, active owners & canStopSafely
  start [--idle-timeout 30m|never]  Ensure background daemon is running (--headless / --headed)
  stop [--force]                    Close daemon & managed Chrome (refuses if other owners are active)
  restart [--force]                 Reload config.json and restart daemon & managed Chrome
  claim <pageId> --owner <name>     Lock a tab to your agent owner
  release <pageId>                  Release ownership lock on a tab
  config <init|path|validate>       Create or validate ~/.config/agent-skills/my-agent-browser/config.json
  doctor [--json]                   Offline diagnostics (paths, versions, config, daemon status)
  check-update [--json]             Check release & notice feed without starting browser

Global Options:
  --owner <name>                    Agent owner identity (or env MY_AGENT_BROWSER_OWNER)
  --force                           Override another owner's lock on tab mutation or browser stop
  --page <pageId>                   Pass numeric pageId as an option instead of positional argument
  --json                            Output structured JSON on stdout
  --raw                             Output raw return value on 'eval' for shell pipelines
  --rpc-timeout-ms <ms>             Override daemon RPC timeout (default 65000ms)
  --no-update-check                 Disable update checks and cached stderr notices
  --dev-config                      Allow skill-directory .config.json

Run 'my-agent-browser <command> --help' for details on any command or upstream tool.`);
}

function formatToolHelp(tool) {
  const schema = tool.inputSchema || { properties: {}, required: [] };
  const required = new Set(schema.required || []);
  const props = Object.entries(schema.properties || {});
  const posUsage = props
    .filter(([k]) => required.has(k))
    .map(([k]) => `<${k}>`)
    .join(" ");

  const lines = [
    `${tool.name} — ${tool.description || ""}`,
    "",
    `Usage:`,
    `  my-agent-browser ${tool.name}${posUsage ? " " + posUsage : ""} [options]`,
    `  my-agent-browser call ${tool.name} --args-json '<json>'`,
  ];
  if (props.length > 0) {
    lines.push("", "Parameters:");
    for (const [key, spec] of props) {
      const reqLabel = required.has(key) ? "required" : "optional";
      const typeLabel = spec.enum ? `enum(${spec.enum.join("|")})` : spec.type || "any";
      const kebab = key.replace(/([A-Z])/g, "-$1").toLowerCase();
      const flag = kebab !== key ? `--${kebab} / --${key}` : `--${key}`;
      lines.push(`  ${flag} (${typeLabel}, ${reqLabel})`);
      if (spec.description) lines.push(`      ${spec.description}`);
    }
  }
  console.log(lines.join("\n"));
}

function findInstalledSkillInfo() {
  const home = os.homedir();
  const candidates = [
    path.join(home, ".agents", "skills", "my-agent-browser", "SKILL.md"),
    path.join(home, ".claude", "skills", "my-agent-browser", "SKILL.md"),
    path.join(home, ".gemini", "config", "skills", "my-agent-browser", "SKILL.md"),
    path.resolve(__dirname, "..", "skills", "my-agent-browser", "SKILL.md"),
  ];
  for (const file of candidates) {
    if (file && fs.existsSync(file)) {
      try {
        const text = fs.readFileSync(file, "utf8");
        const verMatch = /^\s*version:\s*"?([0-9]+\.[0-9]+\.[0-9]+)"?/m.exec(text);
        return { path: file, version: verMatch ? verMatch[1] : null };
      } catch {}
    }
  }
  return null;
}

async function runDoctor(globals) {
  const mcpInfo = resolveMcpPackage({ env: process.env });
  const skillInfo = findInstalledSkillInfo();
  const callerOwner = resolveOwner(globals.owner, process.env);
  const daemon = await inspectDaemon({ env: process.env, callerOwner });
  const legacyLockPath = getLegacyLockPath(process.env);

  const report = {
    version: VERSION,
    skillVersion: skillInfo?.version || null,
    skillPath: skillInfo?.path || null,
    cliPath: __filename,
    node: process.version,
    nodePath: process.execPath,
    socketPath: getSocketPath(process.env),
    owner: callerOwner || null,
    chromePath: findChrome(),
    mcpPath: mcpInfo?.binPath || null,
    mcpSource: mcpInfo?.source || null,
    mcpVersion: mcpInfo?.version || null,
    expectedMcpVersion: TESTED_MCP_VERSION,
    mcpMatchesTestedVersion: mcpInfo?.version === TESTED_MCP_VERSION,
    legacyV1LockFound: fs.existsSync(legacyLockPath),
    daemon: daemon
      ? {
          pid: daemon.pid,
          version: daemon.version,
          versionMatchesCli: daemon.version === VERSION,
          startedAt: daemon.startedAt,
          browserMode: daemon.browserMode,
          browserReady: daemon.browserReady,
          browserPid: daemon.browserPid,
          idleTimeout: daemon.idleTimeout,
          idleMs: daemon.idleMs,
          openPages: daemon.pages?.length ?? 0,
          activeOwners: daemon.activeOwners || [],
          canStopSafely: daemon.canStopSafely,
        }
      : null,
    capabilities: [
      "cli-daemon",
      "owner-locks",
      "idle-timeout",
      "pageId-routing",
      "mcp-reinitialize",
      "no-tool-replay",
      "stealth-evaluate",
      "bounded-batch",
    ],
  };

  try {
    const loaded = loadConfig({ env: process.env, devConfig: globals.devConfig });
    report.configPath = loaded.configPath;
    report.configExists = loaded.exists;
    const b = loaded.config.browser || {};
    report.mode = b.browserUrl ? "direct" : "managed";
    report.configuredIdleTimeout = b.idleTimeout !== undefined ? b.idleTimeout : "30m";
    parseIdleTimeout(b.idleTimeout);
    report.batchActionsEnabled = loaded.config.mcp?.batchActions !== false && report.mcpMatchesTestedVersion;
  } catch (err) {
    report.configError = err.message;
    process.exitCode = 1;
  }

  if (!report.mcpPath || !report.mcpMatchesTestedVersion) {
    process.exitCode = 1;
  }

  console.log(JSON.stringify(report, null, globals.json ? undefined : 2));
}

function outputError(message, asJson, extra = {}) {
  if (asJson) {
    console.log(JSON.stringify({ ok: false, isError: true, error: message, ...extra }));
  } else {
    process.stderr.write(`Error: ${message}\n`);
  }
  process.exitCode = 1;
}

function outputToolResponse(resp, globals, { isEval = false } = {}) {
  if (!resp || resp.isError || !resp.ok) {
    const extra = {};
    if (resp?.structuredContent) extra.structuredContent = resp.structuredContent;
    if (resp?.blocked) extra.blocked = resp.blocked;
    if (resp?.blockers) extra.blockers = resp.blockers;
    outputError(resp?.error || resp?.text || "Command failed", globals.json, extra);
    return;
  }
  if (globals.json) {
    console.log(
      JSON.stringify({
        ok: true,
        text: resp.text,
        structuredContent: resp.structuredContent,
        ...(resp.pages ? { pages: resp.pages } : {}),
      })
    );
    return;
  }
  if (isEval && globals.raw) {
    console.log(extractRawEvalValue(resp.text));
    return;
  }
  if (resp.pages) {
    if (resp.pages.length === 0) {
      console.log("No open pages.");
      return;
    }
    const lines = resp.pages.map((p) => {
      const sel = p.selected ? " [selected]" : "";
      const own = p.owner ? `  owner=${p.owner}` : "";
      const idle = p.idleMs !== null ? `  idle=${formatDuration(p.idleMs)}` : "";
      return `${p.pageId}: ${p.title || "(untitled)"} (${p.url})${sel}${own}${idle}`;
    });
    console.log(lines.join("\n"));
    return;
  }
  if (resp.text) console.log(resp.text);
}

function resolveBuiltinAlias(cmd, rawArgs, globals) {
  const normalized = toSnakeCase(cmd);

  if (normalized === "pages" || normalized === "list_pages") {
    const { options } = parseSubcommandTokens(rawArgs);
    assertAllowedOptions(options, [], cmd);
    const ownerFilter = globals.owner !== undefined ? resolveOwner(globals.owner, {}) : undefined;
    return { tool: "list_pages", arguments: {}, ...(ownerFilter ? { ownerFilter } : {}) };
  }

  if (normalized === "open" || normalized === "new_page") {
    const { positionals, options } = parseSubcommandTokens(
      rawArgs,
      new Set(["background", "foreground"]),
    );
    assertAllowedOptions(options, ["url", "background", "foreground", "isolatedContext", "timeout"], cmd);
    const url = options.url ?? positionals[0];
    if (!url) throw new Error("open requires <url> (e.g. my-agent-browser open https://example.com)");
    const args = { url: String(url) };
    if (options.foreground === true) args.background = false;
    else if (options.background !== undefined) args.background = Boolean(options.background);
    if (options.isolatedContext !== undefined) args.isolatedContext = String(options.isolatedContext);
    if (options.timeout !== undefined) args.timeout = parseStrictInt(options.timeout, "timeout");
    return { tool: "new_page", arguments: args };
  }

  if (normalized === "goto" || normalized === "navigate_page") {
    const { positionals, options } = parseSubcommandTokens(rawArgs, new Set(["ignoreCache"]));
    assertAllowedOptions(options, ["url", "type", "ignoreCache", "handleBeforeUnload", "initScript", "timeout"], cmd);
    const pageId = requirePageId(globals, positionals);
    const url = options.url ?? positionals[0];
    const args = { pageId };
    if (options.type !== undefined) args.type = String(options.type);
    if (url !== undefined) args.url = String(url);
    if (!args.url && !args.type) throw new Error("goto requires <url> or --type <reload|back|forward>");
    if (options.ignoreCache !== undefined) args.ignoreCache = Boolean(options.ignoreCache);
    if (options.handleBeforeUnload !== undefined) args.handleBeforeUnload = String(options.handleBeforeUnload);
    if (options.initScript !== undefined) args.initScript = String(options.initScript);
    if (options.timeout !== undefined) args.timeout = parseStrictInt(options.timeout, "timeout");
    return { tool: "navigate_page", arguments: args };
  }

  if (normalized === "reload" || normalized === "back" || normalized === "forward") {
    const { positionals, options } = parseSubcommandTokens(rawArgs, new Set(["ignoreCache"]));
    assertAllowedOptions(options, ["ignoreCache", "timeout"], cmd);
    const pageId = requirePageId(globals, positionals);
    const args = { pageId, type: normalized };
    if (options.ignoreCache !== undefined) args.ignoreCache = Boolean(options.ignoreCache);
    if (options.timeout !== undefined) args.timeout = parseStrictInt(options.timeout, "timeout");
    return { tool: "navigate_page", arguments: args };
  }

  if (normalized === "select_page") {
    const { positionals, options } = parseSubcommandTokens(rawArgs, new Set(["bringToFront"]));
    assertAllowedOptions(options, ["bringToFront"], cmd);
    const pageId = requirePageId(globals, positionals);
    const args = { pageId };
    if (options.bringToFront !== undefined) args.bringToFront = Boolean(options.bringToFront);
    return { tool: "select_page", arguments: args };
  }

  if (normalized === "close_page" || normalized === "close") {
    const { positionals, options } = parseSubcommandTokens(rawArgs);
    assertAllowedOptions(options, [], cmd);
    const pageId = requirePageId(globals, positionals);
    return { tool: "close_page", arguments: { pageId } };
  }

  if (normalized === "snap" || normalized === "snapshot" || normalized === "take_snapshot") {
    const { positionals, options } = parseSubcommandTokens(rawArgs, new Set(["verbose"]));
    assertAllowedOptions(options, ["filePath", "file", "verbose"], cmd);
    const pageId = requirePageId(globals, positionals);
    const filePath = options.filePath ?? options.file ?? positionals[0];
    const args = { pageId };
    if (options.verbose !== undefined) args.verbose = Boolean(options.verbose);
    if (filePath !== undefined) args.filePath = String(filePath);
    return { tool: "take_snapshot", arguments: normalizeToolPaths("take_snapshot", args) };
  }

  if (normalized === "shot" || normalized === "screenshot" || normalized === "take_screenshot") {
    const { positionals, options } = parseSubcommandTokens(rawArgs, new Set(["fullPage"]));
    assertAllowedOptions(options, ["filePath", "file", "fullPage", "uid", "format", "quality"], cmd);
    const pageId = requirePageId(globals, positionals);
    const filePath = options.filePath ?? options.file ?? positionals[0];
    const args = { pageId };
    if (filePath !== undefined) args.filePath = String(filePath);
    if (options.fullPage !== undefined) args.fullPage = Boolean(options.fullPage);
    if (options.uid !== undefined) args.uid = String(options.uid);
    if (options.format !== undefined) args.format = String(options.format);
    if (options.quality !== undefined) args.quality = parseStrictNumber(options.quality, "quality");
    return { tool: "take_screenshot", arguments: normalizeToolPaths("take_screenshot", args) };
  }

  if (normalized === "click") {
    const { positionals, options } = parseSubcommandTokens(rawArgs, new Set(["dblClick", "includeSnapshot"]));
    assertAllowedOptions(options, ["uid", "dblClick", "includeSnapshot"], cmd);
    const pageId = requirePageId(globals, positionals);
    const uid = options.uid ?? positionals[0];
    if (!uid) throw new Error("click requires <uid>");
    const args = { pageId, uid: String(uid) };
    if (options.dblClick !== undefined) args.dblClick = Boolean(options.dblClick);
    if (options.includeSnapshot !== undefined) args.includeSnapshot = Boolean(options.includeSnapshot);
    return { tool: "click", arguments: args };
  }

  if (normalized === "fill") {
    const { positionals, options } = parseSubcommandTokens(rawArgs, new Set(["includeSnapshot"]));
    assertAllowedOptions(options, ["uid", "value", "includeSnapshot"], cmd);
    const pageId = requirePageId(globals, positionals);
    const uid = options.uid ?? positionals[0];
    const value = options.value ?? positionals[1];
    if (!uid || value === undefined) throw new Error("fill requires <uid> <value>");
    const args = { pageId, uid: String(uid), value: String(value) };
    if (options.includeSnapshot !== undefined) args.includeSnapshot = Boolean(options.includeSnapshot);
    return { tool: "fill", arguments: args };
  }

  if (normalized === "fill_form") {
    const { positionals, options } = parseSubcommandTokens(rawArgs, new Set(["includeSnapshot"]));
    assertAllowedOptions(options, ["elements", "includeSnapshot"], cmd);
    const pageId = requirePageId(globals, positionals);
    let elements;
    if (options.elements !== undefined) {
      elements = JSON.parse(String(options.elements));
    } else if (positionals.length === 1 && positionals[0].trim().startsWith("[")) {
      elements = JSON.parse(positionals[0]);
    } else if (positionals.length > 0) {
      elements = positionals.map((pair) => {
        const eq = pair.indexOf("=");
        if (eq <= 0) throw new Error(`fill-form entry must be 'uid=value' or JSON array, got: ${pair}`);
        return { uid: pair.slice(0, eq), value: pair.slice(eq + 1) };
      });
    } else {
      throw new Error("fill-form requires <uid=value...> pairs or --elements '<json>'");
    }
    const args = { pageId, elements };
    if (options.includeSnapshot !== undefined) args.includeSnapshot = Boolean(options.includeSnapshot);
    return { tool: "fill_form", arguments: args };
  }

  if (normalized === "hover") {
    const { positionals, options } = parseSubcommandTokens(rawArgs, new Set(["includeSnapshot"]));
    assertAllowedOptions(options, ["uid", "includeSnapshot"], cmd);
    const pageId = requirePageId(globals, positionals);
    const uid = options.uid ?? positionals[0];
    if (!uid) throw new Error("hover requires <uid>");
    const args = { pageId, uid: String(uid) };
    if (options.includeSnapshot !== undefined) args.includeSnapshot = Boolean(options.includeSnapshot);
    return { tool: "hover", arguments: args };
  }

  if (normalized === "drag") {
    const { positionals, options } = parseSubcommandTokens(rawArgs, new Set(["includeSnapshot"]));
    assertAllowedOptions(options, ["fromUid", "from_uid", "toUid", "to_uid", "includeSnapshot"], cmd);
    const pageId = requirePageId(globals, positionals);
    const fromUid = options.fromUid ?? options.from_uid ?? positionals[0];
    const toUid = options.toUid ?? options.to_uid ?? positionals[1];
    if (!fromUid || !toUid) throw new Error("drag requires <fromUid> <toUid>");
    const args = { pageId, from_uid: String(fromUid), to_uid: String(toUid) };
    if (options.includeSnapshot !== undefined) args.includeSnapshot = Boolean(options.includeSnapshot);
    return { tool: "drag", arguments: args };
  }

  if (normalized === "press" || normalized === "press_key") {
    const { positionals, options } = parseSubcommandTokens(rawArgs, new Set(["includeSnapshot"]));
    assertAllowedOptions(options, ["key", "includeSnapshot"], cmd);
    const pageId = requirePageId(globals, positionals);
    const key = options.key ?? positionals[0];
    if (!key) throw new Error("press requires <key> (e.g. Enter, Escape, Control+A)");
    const args = { pageId, key: String(key) };
    if (options.includeSnapshot !== undefined) args.includeSnapshot = Boolean(options.includeSnapshot);
    return { tool: "press_key", arguments: args };
  }

  if (normalized === "type" || normalized === "type_text") {
    const { positionals, options } = parseSubcommandTokens(rawArgs);
    assertAllowedOptions(options, ["text", "submitKey"], cmd);
    const pageId = requirePageId(globals, positionals);
    const text = options.text ?? positionals[0];
    if (text === undefined) throw new Error("type requires <text>");
    const args = { pageId, text: String(text) };
    if (options.submitKey !== undefined) args.submitKey = String(options.submitKey);
    return { tool: "type_text", arguments: args };
  }

  if (normalized === "upload" || normalized === "upload_file") {
    const { positionals, options } = parseSubcommandTokens(rawArgs, new Set(["includeSnapshot"]), new Set(["filePaths"]));
    assertAllowedOptions(options, ["uid", "filePath", "filePaths", "includeSnapshot"], cmd);
    const pageId = requirePageId(globals, positionals);
    const uid = options.uid ?? positionals.shift();
    const filePaths = options.filePaths ?? (options.filePath ? [options.filePath] : positionals);
    if (!uid || !filePaths.length) throw new Error("upload requires <uid> <filePath...>");
    const args = { pageId, uid: String(uid), filePaths: filePaths.map(String) };
    if (options.includeSnapshot !== undefined) args.includeSnapshot = Boolean(options.includeSnapshot);
    return { tool: "upload_file", arguments: normalizeToolPaths("upload_file", args) };
  }

  if (normalized === "dialog" || normalized === "handle_dialog") {
    const { positionals, options } = parseSubcommandTokens(rawArgs);
    assertAllowedOptions(options, ["action", "promptText"], cmd);
    const pageId = requirePageId(globals, positionals);
    const action = options.action ?? positionals[0];
    if (!action) throw new Error("dialog requires <accept|dismiss>");
    const args = { pageId, action: String(action) };
    if (options.promptText !== undefined) args.promptText = String(options.promptText);
    return { tool: "handle_dialog", arguments: args };
  }

  if (normalized === "wait_for") {
    const { positionals, options } = parseSubcommandTokens(rawArgs, new Set(["visible"]), new Set(["text"]));
    assertAllowedOptions(options, ["text", "timeout", "visible"], cmd);
    const pageId = requirePageId(globals, positionals);
    const texts = options.text ?? positionals;
    if (!texts.length) throw new Error("wait-for requires at least one text string");
    const args = { pageId, text: texts.map(String) };
    if (options.timeout !== undefined) args.timeout = parseStrictInt(options.timeout, "timeout");
    if (options.visible !== undefined) args.visible = Boolean(options.visible);
    return { tool: "wait_for", arguments: args };
  }

  if (normalized === "eval" || normalized === "evaluate_script") {
    const { positionals, options } = parseSubcommandTokens(rawArgs, new Set(["waitForStableDom"]), new Set(["args"]));
    assertAllowedOptions(
      options,
      ["function", "sourcePath", "format", "args", "filePath", "dialogAction", "waitForStableDom", "serviceWorkerId"],
      cmd
    );
    let pageId = globals.pageId;
    if (pageId === undefined && positionals.length > 0 && /^\d+$/.test(positionals[0])) {
      pageId = Number(positionals.shift());
    }
    const fn = options.function ?? positionals[0];
    const args = {};
    if (pageId !== undefined) args.pageId = pageId;
    if (fn !== undefined) args.function = String(fn);
    if (options.sourcePath !== undefined) args.sourcePath = String(options.sourcePath);
    if (options.format !== undefined) args.format = String(options.format);
    if (options.args !== undefined) args.args = options.args.map(String);
    if (options.filePath !== undefined) args.filePath = String(options.filePath);
    if (options.dialogAction !== undefined) args.dialogAction = String(options.dialogAction);
    if (options.waitForStableDom !== undefined) args.waitForStableDom = Boolean(options.waitForStableDom);
    if (options.serviceWorkerId !== undefined) args.serviceWorkerId = String(options.serviceWorkerId);
    if (args.pageId === undefined && !args.serviceWorkerId) {
      throw new Error("eval requires numeric <pageId> (e.g. my-agent-browser eval 1 \"() => document.title\")");
    }
    if (!args.function && !args.sourcePath) {
      throw new Error("eval requires <function> or --source-path <file>");
    }
    return { tool: "evaluate_script", arguments: normalizeToolPaths("evaluate_script", args), isEval: true };
  }

  if (normalized === "batch" || normalized === "run_actions") {
    const { positionals, options } = parseSubcommandTokens(rawArgs);
    assertAllowedOptions(options, ["file", "actions", "snapshot", "snapshotFile", "snapshotFilePath", "timeoutMs", "timeout"], cmd);
    const pageId = requirePageId(globals, positionals);
    let actions;
    if (options.file !== undefined) {
      const parsed = JSON.parse(fs.readFileSync(resolveLocalPath(String(options.file)), "utf8"));
      actions = Array.isArray(parsed) ? parsed : parsed.actions;
    } else if (options.actions !== undefined) {
      actions = JSON.parse(String(options.actions));
    } else if (positionals[0] !== undefined) {
      const parsed = JSON.parse(positionals[0]);
      actions = Array.isArray(parsed) ? parsed : parsed.actions;
    } else {
      throw new Error("batch requires '<actions-json>' or --file <plan.json>");
    }
    const args = { pageId, actions };
    if (options.snapshot !== undefined) args.snapshot = String(options.snapshot);
    else if (options.snapshotFile !== undefined || options.snapshotFilePath !== undefined) args.snapshot = "final";
    if (options.snapshotFile !== undefined || options.snapshotFilePath !== undefined) {
      args.snapshotFilePath = String(options.snapshotFile ?? options.snapshotFilePath);
    }
    if (options.timeoutMs !== undefined || options.timeout !== undefined) {
      args.timeoutMs = parseStrictInt(options.timeoutMs ?? options.timeout, "timeout-ms");
    }
    return { tool: "run_actions", arguments: normalizeToolPaths("run_actions", args) };
  }

  if (normalized === "console" || normalized === "list_console_messages") {
    const { positionals, options } = parseSubcommandTokens(
      rawArgs,
      new Set(["includePreservedMessages", "includeStackTraces"]),
      new Set(["types"]),
    );
    assertAllowedOptions(
      options,
      ["types", "pageSize", "pageIdx", "includePreservedMessages", "includeStackTraces", "serviceWorkerId"],
      cmd
    );
    const pageId = requirePageId(globals, positionals);
    const args = { pageId };
    if (options.types !== undefined) args.types = options.types.map(String);
    if (options.pageSize !== undefined) args.pageSize = parseStrictInt(options.pageSize, "page-size");
    if (options.pageIdx !== undefined) args.pageIdx = parseStrictInt(options.pageIdx, "page-idx");
    if (options.includePreservedMessages !== undefined) args.includePreservedMessages = Boolean(options.includePreservedMessages);
    if (options.includeStackTraces !== undefined) args.includeStackTraces = Boolean(options.includeStackTraces);
    if (options.serviceWorkerId !== undefined) args.serviceWorkerId = String(options.serviceWorkerId);
    return { tool: "list_console_messages", arguments: args };
  }

  if (normalized === "network" || normalized === "list_network_requests") {
    const { positionals, options } = parseSubcommandTokens(
      rawArgs,
      new Set(["includePreservedRequests"]),
      new Set(["resourceTypes"]),
    );
    assertAllowedOptions(options, ["resourceTypes", "pageSize", "pageIdx", "includePreservedRequests"], cmd);
    const pageId = requirePageId(globals, positionals);
    const args = { pageId };
    if (options.resourceTypes !== undefined) args.resourceTypes = options.resourceTypes.map(String);
    if (options.pageSize !== undefined) args.pageSize = parseStrictInt(options.pageSize, "page-size");
    if (options.pageIdx !== undefined) args.pageIdx = parseStrictInt(options.pageIdx, "page-idx");
    if (options.includePreservedRequests !== undefined) args.includePreservedRequests = Boolean(options.includePreservedRequests);
    return { tool: "list_network_requests", arguments: args };
  }

  if (normalized === "logpoints" || normalized === "set_logpoints") {
    const { positionals, options } = parseSubcommandTokens(rawArgs, new Set(["clear"]), new Set(["logpoints"]));
    assertAllowedOptions(options, ["clear", "logpoints"], cmd);
    const pageId = requirePageId(globals, positionals);
    const logpoints = options.clear ? [] : (options.logpoints ?? positionals).map(String);
    if (!options.clear && logpoints.length === 0) {
      throw new Error("logpoints requires at least one '<url>:<line> <expr>' or --clear to remove all");
    }
    return { tool: "set_logpoints", arguments: { pageId, logpoints } };
  }

  return null;
}

async function bindDynamicTool(toolName, rawArgs, globals, { allowAutoSpawn = true } = {}) {
  let listResp;
  if (allowAutoSpawn) {
    listResp = await requestDaemon("list_tools", { callerOwner: resolveOwner(globals.owner, process.env) }, {
      env: process.env,
      devConfig: globals.devConfig,
    });
  } else {
    listResp = await sendRawRequest("list_tools", { callerOwner: resolveOwner(globals.owner, process.env) }, {
      env: process.env,
      timeoutMs: 2500,
    }).catch(() => null);
    if (!listResp?.ok) return null;
  }
  if (!listResp?.ok || !Array.isArray(listResp.tools)) {
    throw new Error(listResp?.error || "Could not discover upstream tools");
  }
  const normalized = toSnakeCase(toolName);
  const tool = listResp.tools.find((t) => t.name === toolName || t.name === normalized);
  if (!tool) {
    throw new Error(
      `Unknown command or tool '${toolName}'. Run 'my-agent-browser --help' or 'my-agent-browser tools' to list available tools.`
    );
  }
  if (globals.help) {
    formatToolHelp(tool);
    return { printedHelp: true };
  }

  const schema = tool.inputSchema || { properties: {}, required: [] };
  const props = schema.properties || {};
  const boolFlags = new Set(Object.entries(props).filter(([, s]) => s.type === "boolean").map(([k]) => k));
  const arrayFlags = new Set(Object.entries(props).filter(([, s]) => s.type === "array").map(([k]) => k));

  const { positionals, options } = parseSubcommandTokens(rawArgs, boolFlags, arrayFlags);
  let bound = {};

  if (options.argsJson !== undefined) {
    const parsed = JSON.parse(String(options.argsJson));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("--args-json must be a JSON object");
    }
    bound = { ...parsed };
    delete options.argsJson;
  }

  if (globals.pageId !== undefined && Object.hasOwn(props, "pageId")) {
    bound.pageId = globals.pageId;
  }

  const reqOrder = (schema.required || []).filter((k) => !Object.hasOwn(bound, k));
  for (const key of reqOrder) {
    if (positionals.length === 0) break;
    if (props[key]?.type === "array") {
      bound[key] = coerceBySchema(positionals.splice(0), props[key], key);
    } else {
      bound[key] = coerceBySchema(positionals.shift(), props[key], key);
    }
  }
  if (positionals.length > 0) {
    throw new Error(
      `Unexpected positional argument(s) for ${tool.name}: ${positionals.join(" ")}. Run 'my-agent-browser ${tool.name} --help'.`
    );
  }

  for (const [optKey, optVal] of Object.entries(options)) {
    if (!Object.hasOwn(props, optKey)) {
      throw new Error(`Unknown option '--${optKey}' for ${tool.name}. Run 'my-agent-browser ${tool.name} --help'.`);
    }
    bound[optKey] = coerceBySchema(optVal, props[optKey], optKey);
  }

  return { tool: tool.name, arguments: normalizeToolPaths(tool.name, bound), isEval: tool.name === "evaluate_script" };
}

function computeRpcTimeout(globals, toolArgs) {
  if (globals.rpcTimeoutMs !== undefined) return globals.rpcTimeoutMs;
  const candidate = Number(toolArgs?.timeoutMs ?? toolArgs?.timeout ?? 0);
  if (Number.isFinite(candidate) && candidate > 0) {
    return Math.max(DEFAULT_RPC_TIMEOUT_MS, candidate + 10_000);
  }
  return DEFAULT_RPC_TIMEOUT_MS;
}

async function main() {
  const { globals, command, args } = parseGlobalAndCommandArgs(process.argv.slice(2));

  if (globals.version && !command) {
    console.log(VERSION);
    return;
  }

  // Handle --help offline without ever spawning a daemon or mutating state!
  if (!command || globals.help) {
    if (command && !LIFECYCLE_COMMANDS.has(command)) {
      const targetName = command === "call" && args[0] ? args[0] : (ALIAS_TO_TOOL[toSnakeCase(command)] || command);
      const res = await bindDynamicTool(targetName, [], globals, { allowAutoSpawn: false }).catch(() => null);
      if (!res?.printedHelp) {
        printMainHelp();
      }
      return;
    }
    printMainHelp();
    return;
  }

  if (command === "doctor") {
    await runDoctor(globals);
    return;
  }

  if (command === "config") {
    const sub = args[0] || "path";
    if (sub === "init") {
      const res = initConfig({ env: process.env });
      if (globals.json) console.log(JSON.stringify({ ok: true, ...res }));
      else console.log(res.created ? `Created ${res.path}` : `Preserved existing config: ${res.path}`);
      return;
    }
    if (sub === "path") {
      const p = path.join(getHomeDir(process.env), "config.json");
      if (globals.json) console.log(JSON.stringify({ ok: true, path: p, exists: fs.existsSync(p) }));
      else console.log(p);
      return;
    }
    if (sub === "validate") {
      const loaded = loadConfig({ env: process.env, devConfig: globals.devConfig });
      if (globals.json) console.log(JSON.stringify({ ok: true, exists: loaded.exists, path: loaded.configPath }));
      else console.log(loaded.exists ? `Valid config: ${loaded.configPath}` : `No config file at ${loaded.configPath} (using built-in defaults)`);
      return;
    }
    throw new Error(`Unknown config subcommand '${sub}'. Expected: init | path | validate`);
  }

  const loaded = loadConfig({ env: process.env, devConfig: globals.devConfig });
  const callerOwner = resolveOwner(globals.owner, process.env);

  if (command === "check-update") {
    const disabled = isUpdateDisabled({
      config: loaded.config,
      env: process.env,
      noUpdateCheck: globals.noUpdateCheck,
    });
    const result = await checkUpdate({ dir: getHomeDir(process.env), disabled, force: true });
    if (result.error && !globals.json) process.stderr.write(`[my-agent-browser] ${result.error}\n`);
    if (globals.json) {
      console.log(JSON.stringify(result));
    } else {
      console.log(
        `Update check: ${result.status}; current ${VERSION}` +
        (result.latest_version ? `; latest ${result.latest_version}` : "")
      );
    }
    return;
  }

  if (command === "status") {
    const daemon = await inspectDaemon({ env: process.env, callerOwner });
    if (!daemon) {
      const idleTimeout = loaded.config.browser?.idleTimeout ?? "30m";
      const out = {
        ok: true,
        running: false,
        configuredMode: loaded.config.browser?.browserUrl ? "direct" : "managed",
        configuredIdleTimeout: idleTimeout,
        canStopSafely: true,
        pages: [],
        activeOwners: [],
      };
      if (globals.json) console.log(JSON.stringify(out));
      else console.log(`Daemon: stopped (starts automatically on first browser command; configured idleTimeout=${idleTimeout})`);
    } else if (globals.json) {
      console.log(JSON.stringify(daemon));
    } else {
      const autoClose = daemon.idleTimeoutMs === 0
        ? "never"
        : `${daemon.idleTimeout} (idle ${formatDuration(daemon.idleMs)})`;
      console.log(`Daemon: running (PID ${daemon.pid}, v${daemon.version})`);
      console.log(`Browser: ${daemon.browserMode} (${daemon.browserReady ? "active" : "lazy-pending"}${daemon.browserPid ? `, PID ${daemon.browserPid}` : ""})`);
      console.log(`Idle timeout: ${autoClose}`);
      console.log(
        `Active owners: ${
          daemon.activeOwners.length
            ? daemon.activeOwners.map((o) => `${o.owner} (pages: ${o.pageIds.join(",")})`).join(", ")
            : "none"
        }`
      );
      console.log(`Open pages: ${daemon.pages.length}`);
      console.log(`Safe to stop now: ${daemon.canStopSafely ? "yes" : `no (${daemon.stopBlockers.length} blocker(s))`}`);
      if (daemon.version !== VERSION) {
        process.stderr.write(
          `Warning: running daemon version (${daemon.version}) differs from CLI (${VERSION}). Run 'my-agent-browser restart' when safe.\n`
        );
      }
    }
  } else if (command === "start") {
    const { options } = parseSubcommandTokens(args, new Set(["headless", "headed"]));
    assertAllowedOptions(options, ["idleTimeout", "headless", "headed"], "start");
    if (options.idleTimeout !== undefined) parseIdleTimeout(options.idleTimeout);
    const headless = options.headed ? false : options.headless ? true : undefined;
    const res = await ensureDaemon({
      env: process.env,
      devConfig: globals.devConfig,
      idleTimeout: options.idleTimeout,
      headless,
    });
    if (!res.started && (options.idleTimeout !== undefined || headless !== undefined)) {
      process.stderr.write("Note: daemon was already running; use 'my-agent-browser restart' to apply new launch options.\n");
    }
    const status = await inspectDaemon({ env: process.env, callerOwner });
    if (globals.json) {
      console.log(JSON.stringify({ ok: true, started: res.started, daemon: status }));
    } else {
      console.log(
        res.started
          ? `Started browser daemon (PID ${status?.pid}, idleTimeout=${status?.idleTimeout}).`
          : `Browser daemon already running (PID ${status?.pid}, idleTimeout=${status?.idleTimeout}).`
      );
    }
  } else if (command === "stop") {
    const daemon = await inspectDaemon({ env: process.env, callerOwner });
    if (!daemon) {
      if (globals.json) console.log(JSON.stringify({ ok: true, stopped: false, message: "Daemon is not running" }));
      else console.log("Browser daemon is not running.");
    } else {
      const resp = await sendRawRequest("stop", { callerOwner, force: globals.force }, { env: process.env, timeoutMs: 10_000 });
      if (!resp.ok) {
        outputError(resp.error || "Failed to stop daemon", globals.json, {
          ...(resp.blocked ? { blocked: resp.blocked } : {}),
          ...(resp.blockers ? { blockers: resp.blockers } : {}),
        });
        return;
      }
      await waitForDaemonExit(process.env, 6000);
      if (globals.json) console.log(JSON.stringify(resp));
      else console.log("Stopped browser daemon" + (resp.closedManagedBrowser ? " and closed managed browser." : "."));
    }
  } else if (command === "restart") {
    const { options } = parseSubcommandTokens(args, new Set(["headless", "headed"]));
    assertAllowedOptions(options, ["idleTimeout", "headless", "headed"], "restart");
    if (options.idleTimeout !== undefined) parseIdleTimeout(options.idleTimeout);
    const existing = await inspectDaemon({ env: process.env, callerOwner });
    if (existing) {
      const stopResp = await sendRawRequest("stop", { callerOwner, force: globals.force }, { env: process.env, timeoutMs: 10_000 });
      if (!stopResp.ok) {
        outputError(stopResp.error || "Refused to restart running browser", globals.json, {
          ...(stopResp.blocked ? { blocked: stopResp.blocked } : {}),
          ...(stopResp.blockers ? { blockers: stopResp.blockers } : {}),
        });
        return;
      }
      await waitForDaemonExit(process.env, 6000);
    }
    const headless = options.headed ? false : options.headless ? true : undefined;
    await ensureDaemon({
      env: process.env,
      devConfig: globals.devConfig,
      idleTimeout: options.idleTimeout,
      headless,
    });
    const status = await inspectDaemon({ env: process.env, callerOwner });
    if (globals.json) console.log(JSON.stringify({ ok: true, restarted: true, daemon: status }));
    else console.log(`Restarted browser daemon (PID ${status?.pid}, idleTimeout=${status?.idleTimeout}).`);
  } else if (command === "tools") {
    const resp = await requestDaemon("list_tools", { callerOwner }, { env: process.env, devConfig: globals.devConfig });
    if (!resp.ok) {
      outputError(resp.error || "Failed to list tools", globals.json);
      return;
    }
    if (globals.json) {
      console.log(JSON.stringify({ ok: true, count: resp.tools.length, tools: resp.tools }));
    } else {
      for (const t of resp.tools) {
        const summary = (t.description || "").split("\n")[0].slice(0, 90);
        console.log(`${t.name.padEnd(32)} ${summary}`);
      }
    }
  } else if (command === "claim") {
    const { positionals, options } = parseSubcommandTokens(args);
    assertAllowedOptions(options, [], "claim");
    const pageId = requirePageId(globals, positionals);
    const resp = await requestDaemon(
      "claim",
      { pageId, owner: callerOwner, force: globals.force },
      { env: process.env, devConfig: globals.devConfig }
    );
    if (!resp.ok) {
      outputError(resp.error || "Failed to claim page", globals.json);
      return;
    }
    if (globals.json) console.log(JSON.stringify(resp));
    else console.log(`Claimed page ${resp.pageId} for owner '${resp.owner}'.`);
  } else if (command === "release") {
    const { positionals, options } = parseSubcommandTokens(args);
    assertAllowedOptions(options, [], "release");
    const pageId = requirePageId(globals, positionals);
    const resp = await requestDaemon(
      "release",
      { pageId, callerOwner, force: globals.force },
      { env: process.env, devConfig: globals.devConfig }
    );
    if (!resp.ok) {
      outputError(resp.error || "Failed to release page", globals.json);
      return;
    }
    if (globals.json) console.log(JSON.stringify(resp));
    else console.log(`Released ownership lock on page ${resp.pageId}.`);
  } else if (command === "call") {
    const targetTool = args[0];
    if (!targetTool) throw new Error("call requires <toolName>");
    const invocation = await bindDynamicTool(targetTool, args.slice(1), globals);
    if (!invocation) return;
    const resp = await requestDaemon(
      "call_tool",
      {
        name: invocation.tool,
        arguments: invocation.arguments,
        callerOwner,
        lockOwner: callerOwner,
        force: globals.force,
      },
      {
        env: process.env,
        devConfig: globals.devConfig,
        timeoutMs: computeRpcTimeout(globals, invocation.arguments),
      }
    );
    outputToolResponse(resp, globals, { isEval: invocation.isEval });
  } else {
    const builtin = resolveBuiltinAlias(command, args, globals);
    const invocation = builtin || (await bindDynamicTool(command, args, globals));
    if (!invocation) return;

    const resp = await requestDaemon(
      "call_tool",
      {
        name: invocation.tool,
        arguments: invocation.arguments,
        callerOwner,
        lockOwner: callerOwner,
        force: globals.force,
      },
      {
        env: process.env,
        devConfig: globals.devConfig,
        timeoutMs: computeRpcTimeout(globals, invocation.arguments),
      }
    );
    if (builtin?.ownerFilter && Array.isArray(resp.pages)) {
      resp.pages = resp.pages.filter((p) => p.owner === builtin.ownerFilter);
    }
    outputToolResponse(resp, globals, { isEval: invocation.isEval });
  }

  if (!process.exitCode && AUTO_UPDATE_COMMANDS.has(command)) {
    const disabled = isUpdateDisabled({
      config: loaded.config,
      env: process.env,
      noUpdateCheck: globals.noUpdateCheck,
    });
    await checkUpdate({ dir: getHomeDir(process.env), disabled }).catch(() => {});
  }
}

if (require.main === module) {
  const asJson = process.argv.includes("--json");
  main().catch((err) => {
    outputError(err.message || String(err), asJson);
    process.exit(1);
  });
}

module.exports = {
  parseGlobalAndCommandArgs,
  parseSubcommandTokens,
  resolveBuiltinAlias,
  normalizeToolPaths,
  extractRawEvalValue,
};
