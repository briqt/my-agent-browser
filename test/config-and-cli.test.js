"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  parseIdleTimeout,
  validateConfig,
  resolveEffectiveConfig,
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
  parseStrictBoolean,
  resolveBuiltinAlias,
  normalizeToolPaths,
  extractRawEvalValue,
  extractSavedShotPath,
} = require("../src/cli.js");
const { validateOwnerName, resolveOwner } = require("../src/protocol.js");

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

test("validateConfig validates slim schema and ignores legacy mcp/lazyStart keys cleanly", () => {
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

  const eff = resolveEffectiveConfig({ browser: { headless: false } });
  assert.equal(eff.browser.headless, false);
  assert.equal(eff.browser.idleTimeout, "30m");
  assert.equal(eff.stealth.evaluateScript, true);
  assert.equal("mcp" in eff, false);
  assert.equal("lazyStart" in eff.browser, false);
});

test("initConfig creates config once and preserves user edits; config is read only from the runtime home", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mab-cfg-"));
  const repoSkill = fs.mkdtempSync(path.join(os.tmpdir(), "mab-skill-"));
  try {
    const env = { ...process.env, MY_AGENT_BROWSER_HOME: home };
    const first = initConfig({ env });
    assert.equal(first.created, true);
    const created = JSON.parse(fs.readFileSync(first.path, "utf8"));
    assert.equal("mcp" in created, false);
    assert.equal("lazyStart" in created.browser, false);

    fs.writeFileSync(first.path, JSON.stringify({ browser: { headless: false, idleTimeout: "never" } }));
    const second = initConfig({ env });
    assert.equal(second.created, false);
    assert.equal(JSON.parse(fs.readFileSync(first.path, "utf8")).browser.headless, false);

    // A stray .config.json in the skill directory or cwd is never consulted.
    fs.writeFileSync(path.join(repoSkill, ".config.json"), "{broken json");
    const prevCwd = process.cwd();
    process.chdir(repoSkill);
    try {
      const loaded = loadConfig({ env });
      assert.deepEqual(loaded.searched, [first.path]);
      assert.equal(loaded.config.browser.headless, false);
    } finally {
      process.chdir(prevCwd);
    }
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

test("buildMcpArgs enables all 50 upstream tools, wsEndpoint auto-detection, and platform workspace", () => {
  const posix = buildMcpArgs("http://127.0.0.1:39813", { platform: "darwin" });
  assert.ok(posix.includes("--browserUrl=http://127.0.0.1:39813"));
  assert.ok(posix.includes("--no-usage-statistics"));
  assert.ok(posix.includes("--no-performance-crux"));
  assert.ok(posix.includes("--experimental-structured-content"));
  assert.ok(posix.includes("--memory-debugging"));
  assert.ok(posix.includes("--category-network-mocks"));
  assert.ok(posix.includes("--category-webauthn"));
  assert.ok(posix.includes("--experimental-vision"));
  assert.ok(posix.includes("--workspace=/"));
  assert.ok(!posix.includes("--allow-unrestricted-paths"));

  const win = buildMcpArgs("ws://127.0.0.1:9222/devtools/browser/abc", { platform: "win32" });
  assert.ok(win.includes("--wsEndpoint=ws://127.0.0.1:9222/devtools/browser/abc"));
  assert.ok(win.includes("--allow-unrestricted-paths"));
});

test("resolveMcpPackageFromCommandPath resolves 1.13 out/Default/gen/ layout", () => {
  const prefix = fs.mkdtempSync(path.join(os.tmpdir(), "mab-win-prefix-"));
  try {
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

test("CLI alias parser normalizes commands, rejects removed background/batch options, and parses =false strictly", () => {
  // eval + --wait-for-stable-dom=false must evaluate to boolean false, not true
  const eval1 = parseGlobalAndCommandArgs(["eval", "2", "() => document.title", "--wait-for-stable-dom=false", "--raw", "--owner", "agent-a"]);
  assert.equal(eval1.globals.raw, true);
  assert.equal(eval1.globals.owner, "agent-a");
  const boundEval1 = resolveBuiltinAlias(eval1.command, eval1.args, eval1.globals);
  assert.deepEqual(boundEval1, {
    tool: "evaluate_script",
    arguments: { pageId: 2, function: "() => document.title", waitForStableDom: false },
  });

  // open rejects --background and --foreground since background opening is unconditional
  const openBg = parseGlobalAndCommandArgs(["open", "https://example.com", "--background"]);
  assert.throws(() => resolveBuiltinAlias(openBg.command, openBg.args, openBg.globals), /Unknown option '--background'/);
  const openFg = parseGlobalAndCommandArgs(["open", "https://example.com", "--foreground"]);
  assert.throws(() => resolveBuiltinAlias(openFg.command, openFg.args, openFg.globals), /Unknown option '--foreground'/);

  // batch alias is removed
  const batchCmd = parseGlobalAndCommandArgs(["batch", "1", "[]"]);
  assert.equal(resolveBuiltinAlias(batchCmd.command, batchCmd.args, batchCmd.globals), null);

  // click-at coordinate shortcut
  const ca = parseGlobalAndCommandArgs(["click-at", "1", "120", "340", "--dbl-click=false"]);
  assert.deepEqual(resolveBuiltinAlias(ca.command, ca.args, ca.globals), {
    tool: "click_at",
    arguments: { pageId: 1, x: 120, y: 340, dblClick: false },
  });

  // reload supports --init-script and --handle-before-unload
  const rl = parseGlobalAndCommandArgs(["reload", "1", "--ignore-cache=false", "--handle-before-unload", "dismiss", "--init-script", "window.x=1"]);
  assert.deepEqual(resolveBuiltinAlias(rl.command, rl.args, rl.globals), {
    tool: "navigate_page",
    arguments: { pageId: 1, type: "reload", ignoreCache: false, handleBeforeUnload: "dismiss", initScript: "window.x=1" },
  });

  // fill-form key=value pairs preserve numeric-looking UID strings
  const ff = parseGlobalAndCommandArgs(["fill-form", "1", "123=hello=world", "1_9=secret"]);
  assert.deepEqual(resolveBuiltinAlias(ff.command, ff.args, ff.globals), {
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
  assert.deepEqual(resolveBuiltinAlias(wf.command, wf.args, wf.globals), {
    tool: "wait_for",
    arguments: { pageId: 1, text: ["Ready", "Loaded"], visible: true, timeout: 5000 },
  });

  // logpoints --clear sends empty array
  const lp = parseGlobalAndCommandArgs(["logpoints", "1", "--clear"]);
  assert.deepEqual(resolveBuiltinAlias(lp.command, lp.args, lp.globals), {
    tool: "set_logpoints",
    arguments: { pageId: 1, logpoints: [] },
  });

  assert.throws(() => parseStrictBoolean("yes", "visible"), /expects boolean/);

  // extractRawEvalValue & extractSavedShotPath
  assert.equal(extractRawEvalValue('Script ran on page and returned:\n```json\n{"ok":true}\n```'), '{"ok":true}');
  assert.equal(extractRawEvalValue('Script ran on page and returned:\n```json\n"Example Title"\n```'), "Example Title");
  assert.equal(extractSavedShotPath({ structuredContent: { savedImages: [{ filePath: "/tmp/a.png" }] } }), "/tmp/a.png");
  assert.equal(extractSavedShotPath({ text: "Took a screenshot.\nSaved screenshot to /tmp/b.png." }), "/tmp/b.png");
});

test("owner name validation accepts clean identifiers and rejects unsafe strings", () => {
  assert.equal(validateOwnerName(""), "");
  assert.equal(validateOwnerName("agent-1:sub_2"), "agent-1:sub_2");
  assert.throws(() => validateOwnerName("-bad"), /owner must be/);
  assert.throws(() => validateOwnerName("has space"), /owner must be/);
  assert.equal(resolveOwner(undefined, { MY_AGENT_BROWSER_OWNER: "env-owner" }), "env-owner");
  assert.equal(resolveOwner("cli-owner", { MY_AGENT_BROWSER_OWNER: "env-owner" }), "cli-owner");
});

test("offline --help prints specific help for built-ins and upstream tools without starting daemon; config show works", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mab-help-"));
  try {
    const env = { ...process.env, MY_AGENT_BROWSER_HOME: home };

    const openHelp = spawnSync(process.execPath, [CLI_PATH, "open", "--help"], { env, encoding: "utf8" });
    assert.equal(openHelp.status, 0);
    assert.match(openHelp.stdout, /open — Open a URL in a new background tab/);
    assert.ok(!openHelp.stdout.includes("--background"));
    assert.ok(!openHelp.stdout.includes("--foreground"));

    const mockHelp = spawnSync(process.execPath, [CLI_PATH, "mock_network", "--help"], { env, encoding: "utf8" });
    assert.equal(mockHelp.status, 0);
    assert.match(mockHelp.stdout, /mock_network —/);
    assert.match(mockHelp.stdout, /--route/);

    const lhHelp = spawnSync(process.execPath, [CLI_PATH, "lighthouse_audit", "--help"], { env, encoding: "utf8" });
    assert.equal(lhHelp.status, 0);
    assert.match(lhHelp.stdout, /lighthouse_audit —/);
    assert.match(lhHelp.stdout, /--mode/);

    const stopHelp = spawnSync(process.execPath, [CLI_PATH, "stop", "--help"], { env, encoding: "utf8" });
    assert.equal(stopHelp.status, 0);
    assert.match(stopHelp.stdout, /stop — Stop the daemon/);

    const cfgShow = spawnSync(process.execPath, [CLI_PATH, "config", "show", "--json"], { env, encoding: "utf8" });
    assert.equal(cfgShow.status, 0);
    const parsedCfg = JSON.parse(cfgShow.stdout);
    assert.equal(parsedCfg.ok, true);
    assert.equal(parsedCfg.config.browser.idleTimeout, "30m");
    assert.equal("mcp" in parsedCfg.config, false);

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

  const badEval = parseGlobalAndCommandArgs(["eval", "() => 1"]);
  assert.throws(() => resolveBuiltinAlias(badEval.command, badEval.args, badEval.globals), /eval requires numeric <pageId>/);

  const pagesAll = parseGlobalAndCommandArgs(["pages"]);
  assert.equal(resolveBuiltinAlias(pagesAll.command, pagesAll.args, pagesAll.globals).ownerFilter, undefined);
  const pagesOwn = parseGlobalAndCommandArgs(["pages", "--owner", "agent-x"]);
  assert.equal(resolveBuiltinAlias(pagesOwn.command, pagesOwn.args, pagesOwn.globals).ownerFilter, "agent-x");
});
