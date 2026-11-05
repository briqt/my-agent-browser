"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { checkUpdate, newer, validateManifest, fetchManifest, ENDPOINT } = require("./update-check");
const HOUR = 3600000;
const manifest = (version = "1.10.0", notice = "first") => ({ schema_version: 1, latest_version: version,
  release_url: "https://github.com/briqt/my-agent-browser/releases/tag/v1.10.0", notice_id: notice, notice: notice ? "A useful notice" : "" });
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mab-update-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const output = [];
  let requests = 0;
  let remote = manifest();
  const options = { dir, current: "1.9.0", now: 100 * HOUR, emit: text => output.push(text),
    fetchImpl: async (url, options) => {
      requests++;
      assert.equal(url, ENDPOINT);
      assert.equal(options.redirect, "error");
      if (remote instanceof Error) throw remote;
      return new Response(JSON.stringify(remote));
    } };
  return { options, output, set: value => remote = value, count: () => requests,
    state: () => JSON.parse(fs.readFileSync(path.join(dir, "update_check.json"), "utf8")) };
}
test("stable SemVer comparison ignores prereleases, malformed, equal and older versions", () => {
  for (const v of ["1.9.0", "1.8.9", "1.10.0-beta.1", "01.10.0", "no", null]) assert.equal(newer(v, "1.9.0"), false);
  assert.equal(newer("v1.10.0+build.2", "1.9.0"), true);
  assert.equal(newer("1.9.0+other", "1.9.0+current"), false);
  assert.equal(newer("2.0.0", "1.99.99"), true);
});
test("manifest validates schema, fixed release host/path, size and sanitizes terminal controls", () => {
  for (const value of [null, [], { ...manifest(), schema_version: 2 }, { ...manifest(), latest_version: "2.0.0-rc.1" },
    { ...manifest(), notice: "x".repeat(1001) }, { ...manifest(), notice_id: "" },
    ...["http://github.com/briqt/my-agent-browser/tree/main", "https://evil.test/release", "https://github.com/other/repo/tree/main",
      "https://user:secret@github.com/briqt/my-agent-browser/tree/main"].map(release_url => ({ ...manifest(), release_url }))]) {
    assert.throws(() => validateManifest(value));
  }
  assert.equal(validateManifest({ ...manifest(), notice: "\x1b[31mred\n\u202eevil" }).notice, "red  evil");
});
test("independent network throttle and notification cooldown; new versions/notices and withdrawals", async t => {
  const f = fixture(t);
  assert.equal((await checkUpdate(f.options)).notifications, 2);
  assert.equal((await checkUpdate({ ...f.options, now: f.options.now + 1000 })).status, "cached");
  assert.equal(f.count(), 1);
  assert.equal((await checkUpdate({ ...f.options, now: f.options.now + HOUR })).notifications, 0);
  f.set(manifest("1.11.0", "second"));
  assert.equal((await checkUpdate({ ...f.options, now: f.options.now + 2 * HOUR })).notifications, 2);
  assert.equal((await checkUpdate({ ...f.options, now: f.options.now + 26 * HOUR })).notifications, 2);
  f.set(manifest("1.11.0", ""));
  assert.equal((await checkUpdate({ ...f.options, now: f.options.now + 51 * HOUR })).notifications, 1);
  assert.equal(f.state().manifest.notice_id, "");
});
test("failures preserve valid cache, back off, do not renew expiry or expose proxy secrets", async t => {
  const f = fixture(t);
  await checkUpdate(f.options);
  f.set(new Error("https://user:password@proxy.invalid"));
  const now = f.options.now + 25 * HOUR;
  const result = await checkUpdate({ ...f.options, now });
  assert.equal(result.status, "unavailable");
  assert.equal(result.notifications, 2);
  assert.equal(result.error, "Update check failed");
  assert.equal(f.state().last_success_at, f.options.now);
  assert.equal(f.state().next_check_at, now + 300000);
  const calls = f.count();
  await checkUpdate({ ...f.options, now: now + 1 });
  assert.equal(f.count(), calls);
  const expired = await checkUpdate({ ...f.options, now: f.options.now + 8 * 24 * HOUR });
  assert.equal(expired.notifications, 0);
  assert.equal(expired.update_available, false);
});
test("unknown schema preserves the whole old manifest", async t => {
  const f = fixture(t);
  await checkUpdate(f.options);
  const old = f.state().manifest;
  f.set({ ...manifest("9.0.0", "replaced"), schema_version: 2 });
  await checkUpdate({ ...f.options, force: true });
  assert.deepEqual(f.state().manifest, old);
});
test("corrupt cache and clock rollback recover; disabled checks do not read or write state", async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.options.dir, "update_check.json"), "bad json");
  assert.equal((await checkUpdate(f.options)).status, "checked");
  assert.equal((await checkUpdate({ ...f.options, now: f.options.now - 2 * HOUR })).status, "checked");
  const before = f.count(), state = f.state();
  assert.equal((await checkUpdate({ ...f.options, disabled: true, force: true })).status, "disabled");
  assert.equal(f.count(), before);
  assert.deepEqual(f.state(), state);
});
test("concurrent checks acquire one lock and emit once; cache errors do not throw", async t => {
  const f = fixture(t);
  const results = await Promise.all(Array.from({ length: 12 }, () => checkUpdate(f.options)));
  assert.equal(results.filter(r => r.status === "checked").length, 1);
  assert.equal(results.filter(r => r.status === "busy").length, 11);
  assert.equal(f.count(), 1);
  assert.equal(f.output.length, 2);
  const badDir = path.join(f.options.dir, "file");
  fs.writeFileSync(badDir, "not a directory");
  assert.equal((await checkUpdate({ ...f.options, dir: badDir })).status, "unavailable");
});
test("HTTP timeout includes stalled body and response size is bounded", async () => {
  await assert.rejects(fetchManifest(() => new Promise(() => {}), 10), /timed out/);
  const stalled = () => Promise.resolve(new Response(new ReadableStream({ start() {} })));
  await assert.rejects(fetchManifest(stalled, 10), /timed out/);
  await assert.rejects(fetchManifest(async () => new Response("x".repeat(65537))), /too large/);
  await assert.rejects(fetchManifest(async () => new Response("x", { headers: { "content-length": "65537" } })), /too large/);
  await assert.rejects(fetchManifest(async () => new Response("", { status: 503 })), /HTTP 503/);
  await assert.rejects(fetchManifest(async () => new Response("not json")), /valid JSON/);
});
test("CLI quick paths and disabled JSON check preserve stdout and never create update cache", t => {
  const f = fixture(t);
  const script = path.join(__dirname, "start-mcp.js");
  const run = args => spawnSync(process.execPath, [script, ...args], {
    env: { ...process.env, MY_AGENT_BROWSER_HOME: f.options.dir }, encoding: "utf8", timeout: 10000 });
  fs.writeFileSync(path.join(f.options.dir, "config.json"), "invalid");
  for (const args of [["--version"], ["--help"], ["--init-config"]]) assert.equal(run(args).status, 0);
  assert.equal(fs.readFileSync(path.join(f.options.dir, "config.json"), "utf8"), "invalid");
  fs.writeFileSync(path.join(f.options.dir, "config.json"), JSON.stringify({ disable_update_check: true }));
  const result = run(["--check-update", "--json"]);
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).status, "disabled");
  const doctor = run(["--doctor", "--json"]);
  assert.equal(doctor.status, 0);
  assert.equal(JSON.parse(doctor.stdout).expectedMcpVersion, require("../version.json").tested_mcp_version);
  assert.deepEqual(fs.readdirSync(f.options.dir), ["config.json"]);
  fs.writeFileSync(path.join(f.options.dir, "config.json"), '{"disable_update_check":"secret-value"}');
  const invalid = run(["--check-update", "--json"]);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /disable_update_check must be boolean/);
  assert.ok(!invalid.stderr.includes("secret-value"));
});

test("stale lock from an exited process is reclaimed; live locks are never evicted", async t => {
  const f = fixture(t);
  const exited = spawnSync(process.execPath, ["-e", ""], { timeout: 10000 });
  const lock = path.join(f.options.dir, "update_check.lock");
  fs.writeFileSync(lock, JSON.stringify({ pid: exited.pid, token: "old" }));
  assert.equal((await checkUpdate(f.options)).status, "checked");
  assert.equal(fs.existsSync(lock), false);
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, token: "live" }));
  assert.equal((await checkUpdate({ ...f.options, force: true })).status, "busy");
  assert.equal(JSON.parse(fs.readFileSync(lock)).token, "live");
});
test("config init preserves changes; local development config requires explicit opt-in", t => {
  const f = fixture(t);
  const skill = path.join(f.options.dir, "skill");
  fs.cpSync(path.join(__dirname, ".."), skill, { recursive: true });
  const home = path.join(f.options.dir, "runtime");
  const run = args => spawnSync(process.execPath, [path.join(skill, "scripts/start-mcp.js"), ...args], {
    env: { ...process.env, MY_AGENT_BROWSER_HOME: home }, encoding: "utf8", timeout: 10000 });
  assert.equal(run(["--init-config"]).status, 0);
  const configFile = path.join(home, "config.json");
  assert.equal(JSON.parse(fs.readFileSync(configFile)).disable_update_check, false);
  fs.writeFileSync(configFile, '{"browser":{"lazyStart":false}}');
  assert.equal(run(["--init-config"]).status, 0);
  assert.equal(fs.readFileSync(configFile, "utf8"), '{"browser":{"lazyStart":false}}');
  fs.writeFileSync(path.join(skill, ".config.json"), '{"browser":{"lazyStart":true}}');
  assert.equal(JSON.parse(run(["--doctor", "--json"]).stdout).mode, "eager");
  assert.equal(JSON.parse(run(["--doctor", "--json", "--dev-config"]).stdout).mode, "lazy");
  fs.writeFileSync(path.join(skill, ".config.json"), 'invalid');
  assert.equal(run(["--doctor", "--json", "--dev-config"]).status, 1);
  assert.equal(run(["--doctor", "--json"]).status, 0);
});
test("published feed points to a stable version no newer than local release metadata", t => {
  const file = path.join(__dirname, "../../../notice.json");
  if (!fs.existsSync(file)) return t.skip("distribution feed is repository-only");
  const feed = validateManifest(JSON.parse(fs.readFileSync(file, "utf8")));
  assert.equal(newer(feed.latest_version, require("../version.json").version), false);
});
test("explicit JSON checks keep reminders on stderr and optional failures exit zero", t => {
  const f = fixture(t);
  const preload = path.join(f.options.dir, "fetch.cjs");
  const run = () => spawnSync(process.execPath, ["--require", preload, path.join(__dirname, "start-mcp.js"), "--check-update", "--json"], {
    env: { ...process.env, MY_AGENT_BROWSER_HOME: f.options.dir }, encoding: "utf8", timeout: 10000 });
  fs.writeFileSync(path.join(f.options.dir, "config.json"), "{}");
  fs.writeFileSync(preload, `globalThis.fetch = async () => new Response(${JSON.stringify(JSON.stringify(manifest("99.0.0")))});`);
  const available = run();
  assert.equal(available.status, 0);
  assert.equal(JSON.parse(available.stdout).update_available, true);
  assert.match(available.stderr, /\[my-agent-browser update\]/);
  assert.match(available.stderr, /\[my-agent-browser notice\]/);
  fs.writeFileSync(preload, 'globalThis.fetch = async () => { throw new Error("offline"); };');
  const failed = run();
  assert.equal(failed.status, 0);
  assert.equal(JSON.parse(failed.stdout).status, "unavailable");
  assert.match(failed.stderr, /Update check failed/);
});
