"use strict";

// Unit tests for the pure helpers in start-mcp.js.
// Run: node --test skills/my-agent-browser/scripts/
//
// The end-to-end check that a page really cannot see `pptr:` in a stack trace lives
// in stealth-e2e.js — it needs a real Chrome and is not part of this suite.

const test = require("node:test");
const assert = require("node:assert");
const vm = require("node:vm");

const {
  buildChromeArgs,
  stealthConfig,
  wrapStealthFunction,
  rewriteClientLine,
} = require("./start-mcp.js");

// puppeteer's own regex — if a wrapped script stops matching it, puppeteer goes back
// to appending its `pptr:` sourceURL and the stealth rewrite silently stops working.
const PUPPETEER_SOURCE_URL_REGEX = /^[\x20\t]*\/\/[@#] sourceURL=\s{0,10}(\S*?)\s{0,10}$/m;

function toolCall(fnText, name = "evaluate_script") {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 7,
    method: "tools/call",
    params: { name, arguments: { pageId: 1, function: fnText } },
  });
}

function rewrittenFunction(line) {
  return JSON.parse(line).params.arguments.function;
}

test("stealthConfig defaults to enabled", () => {
  assert.deepStrictEqual(stealthConfig({}), { enabled: true, sourceUrl: "eval.js" });
  assert.deepStrictEqual(stealthConfig(undefined), { enabled: true, sourceUrl: "eval.js" });
});

test("stealthConfig honours explicit opt-out and custom sourceUrl", () => {
  assert.strictEqual(stealthConfig({ stealth: { evaluateScript: false } }).enabled, false);
  assert.strictEqual(stealthConfig({ stealth: { sourceUrl: "app.js" } }).sourceUrl, "app.js");
});

test("stealthConfig rejects a sourceUrl that would break out of the comment", () => {
  // Whitespace or a newline here would terminate the `//# sourceURL=` line and
  // corrupt every evaluated script.
  for (const bad of ["a b", "x\ny", "  ", ""]) {
    assert.strictEqual(stealthConfig({ stealth: { sourceUrl: bad } }).sourceUrl, "eval.js");
  }
});

test("wrapped script still satisfies puppeteer's sourceURL regex", () => {
  const wrapped = wrapStealthFunction("() => 1", "eval.js");
  assert.ok(
    PUPPETEER_SOURCE_URL_REGEX.test(`(${wrapped})`),
    "puppeteer would re-tag this script with its own pptr: sourceURL",
  );
});

test("wrapped script parses the way chrome-devtools-mcp evaluates it", () => {
  // chrome-devtools-mcp runs `(${fnString})`, so the closing paren must not land
  // inside a trailing line comment.
  for (const fn of [
    "() => 1",
    "() => 1 // trailing comment",
    "async () => { return 2; }\n// dangling",
  ]) {
    const wrapped = wrapStealthFunction(fn, "eval.js");
    assert.doesNotThrow(() => new vm.Script(`(${wrapped})`), `failed for: ${fn}`);
  }
});

test("wrapped script returns the original value, args and all", async () => {
  const wrapped = wrapStealthFunction("(a, b) => a + b", "eval.js");
  const fn = vm.runInNewContext(`(${wrapped})`, { setTimeout });
  assert.strictEqual(await fn(2, 3), 5);
});

test("wrapped script propagates both sync throws and rejections", async () => {
  const thrower = vm.runInNewContext(
    `(${wrapStealthFunction("() => { throw new Error('boom'); }", "eval.js")})`,
    { setTimeout },
  );
  await assert.rejects(() => thrower(), /boom/);

  const rejecter = vm.runInNewContext(
    `(${wrapStealthFunction("async () => { throw new Error('async boom'); }", "eval.js")})`,
    { setTimeout },
  );
  await assert.rejects(() => rejecter(), /async boom/);
});

test("rewriteClientLine rewrites evaluate_script calls", () => {
  const out = rewriteClientLine(toolCall("() => document.title"), stealthConfig({}));
  const fn = rewrittenFunction(out);
  assert.match(fn, /\/\/# sourceURL=eval\.js/);
  assert.match(fn, /setTimeout/);
  assert.match(fn, /document\.title/);
});

test("rewriteClientLine leaves everything else untouched", () => {
  const stealth = stealthConfig({});
  const untouched = [
    toolCall("() => 1", "take_snapshot"),
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    "not json at all",
    "",
  ];
  for (const line of untouched) {
    assert.strictEqual(rewriteClientLine(line, stealth), line);
  }
});

test("rewriteClientLine is a no-op when disabled", () => {
  const line = toolCall("() => 1");
  const stealth = stealthConfig({ stealth: { evaluateScript: false } });
  assert.strictEqual(rewriteClientLine(line, stealth), line);
});

test("rewriteClientLine defers to a caller-supplied sourceURL", () => {
  const line = toolCall("() => 1\n//# sourceURL=mine.js\n");
  assert.strictEqual(rewriteClientLine(line, stealthConfig({})), line);
});

test("rewriteClientLine survives malformed arguments", () => {
  const stealth = stealthConfig({});
  const malformed = [
    JSON.stringify({ method: "tools/call", params: { name: "evaluate_script" } }),
    JSON.stringify({ method: "tools/call", params: { name: "evaluate_script", arguments: {} } }),
    JSON.stringify({ method: "tools/call", params: { name: "evaluate_script", arguments: { function: 42 } } }),
  ];
  for (const line of malformed) {
    assert.strictEqual(rewriteClientLine(line, stealth), line);
  }
});

test("buildChromeArgs no longer ships fingerprint-damaging defaults", () => {
  // --disable-gpu kills WebGL outright (software WebGL needs --enable-unsafe-swiftshader
  // since Chrome 110), and --disable-blink-features=AutomationControlled only triggers
  // Chrome's yellow warning bar, costing ~52px of viewport, without changing
  // navigator.webdriver unless something also passes --enable-automation.
  const args = buildChromeArgs({}, 39813, "/tmp/profile");
  for (const bad of ["--disable-gpu", "--disable-blink-features=AutomationControlled", "--hide-scrollbars", "--enable-automation"]) {
    assert.ok(!args.includes(bad), `${bad} should not be a built-in default`);
  }
});
