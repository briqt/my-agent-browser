"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  parseIdleTimeout,
  validateConfig,
  loadConfig,
  initConfig,
} = require("../src/config.js");
const {
  buildChromeArgs,
  buildMcpArgs,
  resolveMcpPackageFromCommandPath,
} = require("../src/chrome.js");
const {
  parseGlobalAndCommandArgs,
  resolveBuiltinAlias,
  normalizeToolPaths,
  extractRawEvalValue,
} = require("../src/cli.js");
const { validateOwnerName, resolveOwner } = require("../src/protocol.js");
const { spawnSync } = require("node:child_process");

const CLI_PATH = path.resolve(__dirname, "..", "src", "cli.js");

test("parseIdleTimeout supports ms/s/m/h units and never/0, rejecting ambiguous bare numbers", () => {
  assert.equal(parseIdleTimeout(undefined), 30 * 60 * 1000);
  assert.equal(parseIdleTimeout("30m"), 30 * 60 * 1000);
  assert.equal(parseIdleTimeout("2h"), 2 * 3600 * 1000);
  assert.equal(parseIdleTimeout("45s"), 45 * 1000);
  assert.equal(parseIdleTimeout("500ms"), 500);
  assert.equal(parseIdleTimeout("never"), 0);
  assert.equal(parseIdleTimeout("NEVER"), 0);
  assert.equal(parseIdleTimeout("off"), 0);
  assert.equal(parseIdleTimeout("0"), 0);
  assert.equal(parseIdleTimeout(0), 0);

  assert.throws(() => parseIdleTimeout(1800), /must be 0 or a string with unit/);
  assert.throws(() => parseIdleTimeout("30"), /must match/);
  assert.throws(() => parseIdleTimeout("999999h"), /exceeds maximum timer/);
});

test("validateConfig accepts legacy v1 configs and v2 idleTimeout", () => {
  assert.doesNotThrow(() =>
    validateConfig({
      browser: { headless: true, debuggingPort: 39813, lazyStart: true },
      mcp: { backgroundNewPages: true, batchActions: true, flags: ["--categoryNetworkMocks"] },
      stealth: { evaluateScript: true, sourceUrl: "app.js" },
      disable_update_check: false,
    })
  );
  assert.doesNotThrow(() => validateConfig({ browser: { idleTimeout: "never" } }));
  assert.doesNotThrow(() => validateConfig({ browser: { idleTimeout: 0 } }));
  assert.throws(() => validateConfig({ browser: { headless: "yes" } }), /config\.browser\.headless must be boolean/);
  assert.throws(() => validateConfig({ browser: { debuggingPort: 70000 } }), /between 1 and 65535/);
});

test("initConfig creates config once and preserves user edits; devConfig requires explicit opt-in", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mab-cfg-"));
  const repoSkill = fs.mkdtempSync(path.join(os.tmpdir(), "mab-skill-"));
  try {
    const env = { ...process.env, MY_AGENT_BROWSER_HOME: home };
    const first = initConfig({ env });
    assert.equal(first.created, true);
    fs.writeFileSync(first.path, JSON.stringify({ browser: { headless: false, idleTimeout: "never" } }));
    const second = initConfig({ env });
    assert.equal(second.created, false);
    assert.equal(JSON.parse(fs.readFileSync(first.path, "utf8")).browser.headless, false);

    fs.writeFileSync(path.join(repoSkill, ".config.json"), "{broken json");
    assert.doesNotThrow(() => loadConfig({ env, devConfig: false, repoSkillDir: repoSkill }));
    assert.throws(() => loadConfig({ env, devConfig: true, repoSkillDir: repoSkill }), /invalid JSON/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repoSkill, { recursive: true, force: true });
  }
});

test("buildChromeArgs never injects bot-fingerprint flags", () => {
  const args = buildChromeArgs({ headless: true, viewport: "1280x720" }, 39813, "/tmp/profile");
  assert.ok(!args.includes("--enable-automation"));
  assert.ok(!args.includes("--disable-gpu"));
  assert.ok(!args.includes("--hide-scrollbars"));
  assert.ok(!args.some((a) => a.includes("AutomationControlled")));
  assert.ok(args.includes("--headless=new"));
  assert.ok(args.includes("--window-size=1280,720"));
});

test("buildMcpArgs enables structured content and unrestricted paths unless workspace is set", () => {
  const def = buildMcpArgs({}, "http://127.0.0.1:39813");
  assert.ok(def.includes("--no-usage-statistics"));
  assert.ok(def.includes("--no-performance-crux"));
  assert.ok(def.includes("--experimental-structured-content"));
  assert.ok(def.includes("--allow-unrestricted-paths"));

  const withWorkspace = buildMcpArgs({ mcp: { flags: ["--workspace=/tmp/proj"] } }, "http://127.0.0.1:39813");
  assert.ok(!withWorkspace.includes("--allow-unrestricted-paths"));
  assert.ok(withWorkspace.includes("--workspace=/tmp/proj"));
});

test("resolveMcpPackageFromCommandPath resolves both 1.12 build/ and 1.13 out/Default/gen/ layouts", () => {
  const prefix = fs.mkdtempSync(path.join(os.tmpdir(), "mab-win-prefix-"));
  try {
    // Simulate Windows npm prefix with 1.13 GN/Ninja layout
    const shim = path.join(prefix, "chrome-devtools-mcp.cmd");
    fs.writeFileSync(shim, "@ECHO OFF\r\n");
    const pkgDir = path.join(prefix, "node_modules", "chrome-devtools-mcp");
    const entry = path.join(pkgDir, "out", "Default", "gen", "src", "bin", "chrome-devtools-mcp.js");
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.writeFileSync(entry, "#!/usr/bin/env node\n");
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({
        name: "chrome-devtools-mcp",
        version: "1.13.0",
        bin: { "chrome-devtools-mcp": "./out/Default/gen/src/bin/chrome-devtools-mcp.js" },
      })
    );

    const resolved = resolveMcpPackageFromCommandPath(shim);
    assert.ok(resolved);
    assert.equal(resolved.version, "1.13.0");
    assert.equal(resolved.binPath, entry);
  } finally {
    fs.rmSync(prefix, { recursive: true, force: true });
  }
});

test("CLI alias parser normalizes ergonomic commands and preserves string UIDs", () => {
  const eval1 = parseGlobalAndCommandArgs(["eval", "2", "() => document.title", "--raw", "--owner", "agent-a"]);
  assert.equal(eval1.globals.raw, true);
  assert.equal(eval1.globals.owner, "agent-a");
  const boundEval1 = resolveBuiltinAlias(eval1.command, eval1.args, eval1.globals);
  assert.deepEqual(boundEval1, {
    tool: "evaluate_script",
    arguments: { pageId: 2, function: "() => document.title" },
    isEval: true,
  });

  // Upstream-style --pageId flag order also works
  const eval2 = parseGlobalAndCommandArgs(["evaluate_script", "() => 42", "--pageId", "3"]);
  const boundEval2 = resolveBuiltinAlias(eval2.command, eval2.args, eval2.globals);
  assert.deepEqual(boundEval2.arguments, { pageId: 3, function: "() => 42" });

  // fill-form key=value pairs preserve numeric-looking UID strings
  const ff = parseGlobalAndCommandArgs(["fill-form", "1", "123=hello=world", "1_9=secret"]);
  const boundFf = resolveBuiltinAlias(ff.command, ff.args, ff.globals);
  assert.deepEqual(boundFf, {
    tool: "fill_form",
    arguments: {
      pageId: 1,
      elements: [
        { uid: "123", value: "hello=world" },
        { uid: "1_9", value: "secret" },
      ],
    },
  });

  // wait-for variadic texts
  const wf = parseGlobalAndCommandArgs(["wait-for", "1", "Ready", "Loaded", "--visible", "--timeout", "5000"]);
  const boundWf = resolveBuiltinAlias(wf.command, wf.args, wf.globals);
  assert.deepEqual(boundWf, {
    tool: "wait_for",
    arguments: { pageId: 1, text: ["Ready", "Loaded"], visible: true, timeout: 5000 },
  });

  // logpoints --clear sends empty array
  const lp = parseGlobalAndCommandArgs(["logpoints", "1", "--clear"]);
  const boundLp = resolveBuiltinAlias(lp.command, lp.args, lp.globals);
  assert.deepEqual(boundLp, {
    tool: "set_logpoints",
    arguments: { pageId: 1, logpoints: [] },
  });

  // extractRawEvalValue strips upstream markdown fences
  const wrapped = 'Script ran on page and returned:\n```json\n{"ok":true}\n```';
  assert.equal(extractRawEvalValue(wrapped), '{"ok":true}');
  assert.equal(extractRawEvalValue('Script ran on page and returned:\n```json\n"Example Title"\n```'), "Example Title");
});

test("owner name validation accepts clean identifiers and rejects unsafe strings", () => {
  assert.equal(validateOwnerName(""), "");
  assert.equal(validateOwnerName("agent-1:sub_2"), "agent-1:sub_2");
  assert.throws(() => validateOwnerName("-bad"), /owner must be/);
  assert.throws(() => validateOwnerName("has space"), /owner must be/);
  assert.equal(resolveOwner(undefined, { MY_AGENT_BROWSER_OWNER: "env-owner" }), "env-owner");
  assert.equal(resolveOwner("cli-owner", { MY_AGENT_BROWSER_OWNER: "env-owner" }), "cli-owner");
});

test("audit regressions: --help stays offline, relative paths normalize to CWD, eval requires pageId, pages --owner filters", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mab-help-"));
  try {
    const env = { ...process.env, MY_AGENT_BROWSER_HOME: home };
    for (const args of [["stop", "--help"], ["open", "--help"], ["lighthouse_audit", "--help"]]) {
      const res = spawnSync(process.execPath, [CLI_PATH, ...args], { env, encoding: "utf8" });
      assert.equal(res.status, 0);
      assert.match(res.stdout, /Usage:/);
    }
    assert.deepEqual(fs.readdirSync(home), []);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }

  // Relative path normalization against caller CWD
  const shotParsed = parseGlobalAndCommandArgs(["shot", "1", "./rel-out.png"]);
  const shotBound = resolveBuiltinAlias(shotParsed.command, shotParsed.args, shotParsed.globals);
  assert.equal(shotBound.arguments.filePath, path.resolve("./rel-out.png"));

  const urlSource = normalizeToolPaths("evaluate_script", { pageId: 1, sourcePath: "https://example.com/a.js" });
  assert.equal(urlSource.sourcePath, "https://example.com/a.js");
  const fileSource = normalizeToolPaths("evaluate_script", { pageId: 1, sourcePath: "./local.js" });
  assert.equal(fileSource.sourcePath, path.resolve("./local.js"));

  // eval without pageId must fail locally instead of mutating implicit tab
  const badEval = parseGlobalAndCommandArgs(["eval", "() => 1"]);
  assert.throws(() => resolveBuiltinAlias(badEval.command, badEval.args, badEval.globals), /eval requires numeric <pageId>/);

  // pages --owner filters explicitly, whereas env-only owner shows all tabs for discovery
  const pagesAll = parseGlobalAndCommandArgs(["pages"]);
  assert.equal(resolveBuiltinAlias(pagesAll.command, pagesAll.args, pagesAll.globals).ownerFilter, undefined);
  const pagesOwn = parseGlobalAndCommandArgs(["pages", "--owner", "agent-x"]);
  assert.equal(resolveBuiltinAlias(pagesOwn.command, pagesOwn.args, pagesOwn.globals).ownerFilter, "agent-x");
});
