"use strict";

// puppeteer tags every evaluated script with `//# sourceURL=pptr:...`, embedding
// the chrome-devtools-mcp install path (which normally contains the OS username).
// puppeteer skips its own tag when the script already carries a sourceURL comment
// matching SOURCE_URL_REGEX (see withSourcePuppeteerURLIfNone in puppeteer-core).
const SOURCE_URL_REGEX = /^[\x20\t]*\/\/[@#] sourceURL=\s{0,10}(\S*?)\s{0,10}$/m;
const DEFAULT_STEALTH_SOURCE_URL = "eval.js";

function stealthConfig(config) {
  const s = (config && config.stealth) || {};
  const enabled = s.evaluateScript !== false;
  const raw = typeof s.sourceUrl === "string" ? s.sourceUrl.trim() : "";
  const sourceUrl = raw && !/\s/.test(raw) ? raw : DEFAULT_STEALTH_SOURCE_URL;
  return { enabled, sourceUrl };
}

function wrapStealthFunction(fnText, sourceUrl = DEFAULT_STEALTH_SOURCE_URL) {
  const cleanFn = String(fnText).trimEnd().replace(/;+$/, "");
  return (
    `(...__args) => new Promise((__resolve, __reject) => {\n` +
    `  setTimeout(() => {\n` +
    `    try { __resolve((${cleanFn}\n)(...__args)); } catch (__err) { __reject(__err); }\n` +
    `  }, 0);\n` +
    `})\n//# sourceURL=${sourceUrl}\n`
  );
}

function rewriteClientLine(line, stealth) {
  if (!stealth || !stealth.enabled) return line;
  if (!line.includes("evaluate_script")) return line;
  let msg;
  try { msg = JSON.parse(line); } catch { return line; }
  if (msg.method !== "tools/call") return line;
  if (msg.params?.arguments?.format === "script" || msg.params?.arguments?.sourcePath !== undefined) return line;
  const params = msg.params;
  if (!params || params.name !== "evaluate_script") return line;
  const args = params.arguments;
  if (!args || typeof args.function !== "string") return line;
  if (SOURCE_URL_REGEX.test(args.function)) return line;
  args.function = wrapStealthFunction(args.function, stealth.sourceUrl);
  try { return JSON.stringify(msg); } catch { return line; }
}

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

module.exports = {
  SOURCE_URL_REGEX,
  DEFAULT_STEALTH_SOURCE_URL,
  stealthConfig,
  wrapStealthFunction,
  rewriteClientLine,
  rewriteNewPageBackground,
  rewriteClientRequest,
};
