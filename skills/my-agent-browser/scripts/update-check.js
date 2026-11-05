"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { version: VERSION } = require("../version.json");
const ENDPOINT = "https://raw.githubusercontent.com/briqt/my-agent-browser/main/notice.json";
const HOUR = 3600000;
const MAX_BYTES = 64 * 1024;

// Stable channel only; BigInt avoids lexicographic ordering and integer overflow.
function stableVersion(value) {
  if (typeof value !== "string" || value.length > 100) return null;
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/.exec(value);
  return match ? match.slice(1, 4).map(BigInt) : null;
}
function newer(remote, current) {
  const a = stableVersion(remote), b = stableVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
function cleanText(value) {
  return value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, " ");
}
function validateManifest(value) {
  if (!value || Array.isArray(value) || value.schema_version !== 1 || !stableVersion(value.latest_version)) {
    throw new Error("Invalid manifest schema or stable version");
  }
  if (typeof value.release_url !== "string" || value.release_url.length > 500) throw new Error("Invalid release URL");
  const url = new URL(value.release_url);
  if (url.origin !== "https://github.com" || url.username || url.password || url.search || url.hash ||
      !/^\/briqt\/my-agent-browser\/(?:releases\/tag|tree)\/[A-Za-z0-9._-]+$/.test(url.pathname)) {
    throw new Error("Release URL is outside the distribution repository");
  }
  if (typeof value.notice_id !== "string" || !/^[A-Za-z0-9._-]{0,100}$/.test(value.notice_id) ||
      typeof value.notice !== "string" || value.notice.length > 1000 ||
      Boolean(value.notice_id) !== Boolean(value.notice)) throw new Error("Invalid notice");
  return { schema_version: 1, latest_version: value.latest_version.replace(/^v/, "").split("+")[0],
    release_url: url.href, notice_id: value.notice_id, notice: cleanText(value.notice) };
}
async function fetchManifest(fetchImpl = fetch, timeoutMs = 2000) {
  const controller = new AbortController();
  let reader;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error("Update check timed out")); }, timeoutMs);
  });
  try {
    return await Promise.race([timeout, (async () => {
      const response = await fetchImpl(ENDPOINT, { signal: controller.signal, redirect: "error" });
      if (!response.ok) throw new Error(`Update endpoint returned HTTP ${response.status}`);
      if (Number(response.headers.get("content-length")) > MAX_BYTES) throw new Error("Manifest is too large");
      reader = response.body.getReader();
      let size = 0;
      const chunks = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) throw new Error("Manifest is too large");
        chunks.push(Buffer.from(value));
      }
      let value;
      try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { throw new Error("Manifest is not valid JSON"); }
      return validateManifest(value);
    })()]);
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (reader) void reader.cancel().catch(() => {});
  }
}
function loadState(file, now) {
  let state;
  try { state = JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; }
  if (!state || typeof state !== "object" || Array.isArray(state)) return {};
  const timeFields = ["last_success_at", "next_check_at", "last_notified_version_at", "last_notified_notice_at"];
  for (const key of timeFields) if (!Number.isFinite(state[key]) || state[key] < 0) delete state[key];
  // next_check_at is intentionally in the future; allow its normal one-hour interval.
  if (state.next_check_at > now + HOUR || timeFields.filter(k => k !== "next_check_at").some(k => state[k] > now)) return {};
  try { state.manifest = validateManifest(state.manifest); } catch { delete state.manifest; }
  return state;
}
function notifications(state, current, now) {
  if (!state.manifest || !Number.isFinite(state.last_success_at) || now - state.last_success_at > 7 * 24 * HOUR) return [];
  const m = state.manifest;
  const tips = [];
  if (newer(m.latest_version, current) && (state.last_notified_version !== m.latest_version ||
      !Number.isFinite(state.last_notified_version_at) || now - state.last_notified_version_at >= 24 * HOUR)) {
    tips.push({ kind: "version", id: m.latest_version,
      text: `[my-agent-browser update] ${m.latest_version} available (current ${current}). ${m.release_url}\n` +
        "Update skill: npx skills add briqt/my-agent-browser -g -y. Then check its tested MCP version and restart the MCP session." });
  }
  if (m.notice_id && (state.last_notified_notice !== m.notice_id ||
      !Number.isFinite(state.last_notified_notice_at) || now - state.last_notified_notice_at >= 24 * HOUR)) {
    tips.push({ kind: "notice", id: m.notice_id, text: `[my-agent-browser notice] ${m.notice}` });
  }
  return tips;
}
function acquireLock(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "update_check.lock");
  const token = randomUUID();
  const take = () => {
    const fd = fs.openSync(file, "wx", 0o600);
    try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token })); }
    finally { fs.closeSync(fd); }
    return () => {
      try { if (JSON.parse(fs.readFileSync(file, "utf8")).token === token) fs.unlinkSync(file); } catch {}
    };
  };
  try { return take(); } catch (error) { if (error.code !== "EEXIST") throw error; }
  // Serialize stale-lock recovery too. A live owner is never evicted by elapsed time.
  const reap = file + ".reap";
  try { fs.mkdirSync(reap); } catch { return null; }
  try {
    let owner;
    try { owner = JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
    if (!Number.isInteger(owner.pid) || owner.pid <= 0) return null;
    try { process.kill(owner.pid, 0); return null; }
    catch (error) { if (error.code !== "ESRCH") return null; }
    fs.unlinkSync(file);
    try { return take(); } catch (error) { if (error.code === "EEXIST") return null; throw error; }
  } finally { fs.rmdirSync(reap); }
}
function saveState(file, state) {
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(tmp, JSON.stringify(state) + "\n", { mode: 0o600 }); fs.renameSync(tmp, file); }
  finally { try { fs.unlinkSync(tmp); } catch {} }
}
// Dependency injection is only for tests; endpoint and installation commands are fixed.
async function checkUpdate({ dir, disabled = false, force = false, current = VERSION,
  now = Date.now(), fetchImpl, timeoutMs, emit = text => process.stderr.write(text + "\n") } = {}) {
  if (disabled) return { status: "disabled", current_version: current };
  let release;
  try {
    release = acquireLock(dir);
    if (!release) return { status: "busy", current_version: current };
    const file = path.join(dir, "update_check.json");
    const state = loadState(file, now);
    let status = "cached", error;
    if (force || !state.next_check_at || now >= state.next_check_at) {
      try {
        state.manifest = await fetchManifest(fetchImpl, timeoutMs);
        state.last_success_at = now;
        state.next_check_at = now + HOUR;
        status = "checked";
      } catch (err) {
        state.next_check_at = now + 5 * 60000;
        status = "unavailable";
        // Do not echo arbitrary fetch/proxy errors which may contain credentials.
        error = err.message?.startsWith("Update ") || err.message?.startsWith("Manifest ") ||
          err.message?.startsWith("Invalid ") || err.message?.startsWith("Release URL ") ? err.message : "Update check failed";
      }
    }
    const tips = notifications(state, current, now);
    for (const tip of tips) {
      emit(tip.text);
      state[`last_notified_${tip.kind}`] = tip.id;
      state[`last_notified_${tip.kind}_at`] = now;
    }
    saveState(file, state);
    return { status, current_version: current, latest_version: state.manifest?.latest_version,
      update_available: Boolean(state.manifest && Number.isFinite(state.last_success_at) &&
        now - state.last_success_at <= 7 * 24 * HOUR && newer(state.manifest.latest_version, current)),
      notifications: tips.length, ...(error ? { error } : {}) };
  } catch { return { status: "unavailable", current_version: current, error: "Update cache or lock is unavailable" }; }
  finally { release?.(); }
}
module.exports = { checkUpdate, stableVersion, newer, validateManifest, fetchManifest, notifications, ENDPOINT };
