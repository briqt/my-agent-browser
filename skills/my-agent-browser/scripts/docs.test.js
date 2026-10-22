"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");
const { wrapStealthFunction } = require("./start-mcp");

function markdownFiles(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(root, entry.name);
    return entry.isDirectory() ? markdownFiles(file) : entry.name.endsWith(".md") ? [file] : [];
  });
}

test("every documented function string evaluates to a callable JavaScript function", () => {
  let checked = 0;
  for (const file of markdownFiles(path.join(__dirname, ".."))) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/function:\s*("(?:\\.|[^"\\])*")/g)) {
      const input = JSON.parse(match[1]);
      const fn = vm.runInNewContext(`(${input})`);
      assert.equal(typeof fn, "function", `${file}: ${input}`);
      assert.doesNotThrow(() => new vm.Script(`(${wrapStealthFunction(input, "eval.js")})`));
      checked++;
    }
  }
  assert.ok(checked >= 15, `only found ${checked} executable examples`);
});

test("the documented title example runs through the actual wrapper", async () => {
  const text = fs.readFileSync(path.join(__dirname, "../references/javascript-execution.md"), "utf8");
  const input = JSON.parse(text.match(/function:\s*("(?:\\.|[^"\\])*")/)[1]);
  const fn = vm.runInNewContext(`(${wrapStealthFunction(input, "eval.js")})`, { document: { title: "Example" }, setTimeout });
  assert.equal(await fn(), "Example");
});

test("the background policy is optional and disabled in both the example and schema", () => {
  const root = path.join(__dirname, "..");
  const example = JSON.parse(fs.readFileSync(path.join(root, "config.example.json"), "utf8"));
  const schema = JSON.parse(fs.readFileSync(path.join(root, "config.schema.json"), "utf8"));
  const mcp = schema.properties.mcp;
  assert.equal(example.mcp.backgroundNewPages, false);
  assert.equal(mcp.properties.backgroundNewPages.type, "boolean");
  assert.equal(mcp.properties.backgroundNewPages.default, false);
  assert.ok(!mcp.required?.includes("backgroundNewPages"));
});

test("doctor reports installation paths without creating browser state or changing config", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "my-agent-browser-doctor-"));
  try {
    const config = JSON.stringify({ browser: { headless: true } });
    fs.writeFileSync(path.join(dir, "config.json"), config);
    const result = spawnSync(process.execPath, [path.join(__dirname, "start-mcp.js"), "--doctor", "--json"], {
      env: { ...process.env, MY_AGENT_BROWSER_HOME: dir }, encoding: "utf8", timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.version, "1.3.0");
    assert.equal(report.configPath, path.join(dir, "config.json"));
    assert.equal(report.mode, "lazy");
    assert.equal(fs.readFileSync(report.configPath, "utf8"), config);
    assert.deepEqual(fs.readdirSync(dir), ["config.json"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
