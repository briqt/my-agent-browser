"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { DEFAULT_CONFIG, CONFIG_SCHEMA, validateConfig } = require("../src/config.js");
const { wrapStealthFunction } = require("../src/stealth.js");
const { validateManifest, newer } = require("../src/update-check.js");

const ROOT = path.resolve(__dirname, "..");

function markdownFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? markdownFiles(file) : entry.name.endsWith(".md") ? [file] : [];
  });
}

test("package.json, package-lock.json, SKILL.md metadata.version, and legacy stub version stay in sync", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8"));
  const skillMd = fs.readFileSync(path.join(ROOT, "skills", "my-agent-browser", "SKILL.md"), "utf8");
  const stubJs = fs.readFileSync(path.join(ROOT, "skills", "my-agent-browser", "scripts", "start-mcp.js"), "utf8");

  assert.equal(lock.version, pkg.version);
  const skillVer = /^\s*version:\s*"?([0-9]+\.[0-9]+\.[0-9]+)"?/m.exec(skillMd)?.[1];
  assert.equal(skillVer, pkg.version);

  const stubVer = /const STUB_VERSION = "([^"]+)"/.exec(stubJs)?.[1];
  assert.equal(stubVer, pkg.version);
});

test("skill config.json and config.schema.json match src/config.js definitions and pass validation", () => {
  const skillDir = path.join(ROOT, "skills", "my-agent-browser");
  const template = JSON.parse(fs.readFileSync(path.join(skillDir, "config.json"), "utf8"));
  const schema = JSON.parse(fs.readFileSync(path.join(skillDir, "config.schema.json"), "utf8"));

  assert.deepEqual(template, DEFAULT_CONFIG);
  assert.deepEqual(schema, CONFIG_SCHEMA);
  assert.doesNotThrow(() => validateConfig(template));
});

test("every documented CLI eval function string evaluates to a callable JavaScript function", () => {
  const files = [
    path.join(ROOT, "README.md"),
    path.join(ROOT, "README_CN.md"),
    ...markdownFiles(path.join(ROOT, "skills", "my-agent-browser")),
  ];
  let checked = 0;
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/my-agent-browser eval \d+ ("(?:\\.|[^"\\])*")/g)) {
      const fnSource = JSON.parse(match[1]);
      const fn = vm.runInNewContext(`(${fnSource})`);
      assert.equal(typeof fn, "function", `${file}: ${fnSource}`);
      assert.doesNotThrow(() => new vm.Script(`(${wrapStealthFunction(fnSource, "eval.js")})`));
      checked++;
    }
  }
  assert.ok(checked >= 12, `Expected >= 12 documented CLI eval examples, found ${checked}`);
});

test("published notice.json manifest is valid and never newer than local package.json version", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const manifest = validateManifest(JSON.parse(fs.readFileSync(path.join(ROOT, "notice.json"), "utf8")));
  assert.equal(newer(manifest.latest_version, pkg.version), false);
});
