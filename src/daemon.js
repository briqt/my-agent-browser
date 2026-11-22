#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn, execFileSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { StringDecoder } = require("node:string_decoder");

const {
  VERSION,
  DEFAULT_PORT,
  DEFAULT_IDLE_TIMEOUT,
  getHomeDir,
  getSocketPath,
  getDaemonStatePath,
  formatDuration,
} = require("./protocol.js");
const { loadConfig, parseIdleTimeout } = require("./config.js");
const {
  isProcessAlive,
  probePort,
  waitForPort,
  launchChrome,
  resolveMcpPackage,
  localBrowserUrl,
  buildMcpArgs,
  buildMcpEnv,
} = require("./chrome.js");
const { rewriteClientRequest } = require("./stealth.js");
const { McpSession } = require("./mcp-session.js");

const CHROME_ERROR_PATTERNS = [
  "Could not connect to Chrome",
  "Failed to fetch browser webSocket URL",
  "WebSocket is not open",
  "Connection refused",
  "ECONNREFUSED",
  "Target closed",
  "Session closed",
];

const MCP_STALE_STATE_PATTERNS = [
  "The selected page has been closed",
  "No page selected",
  "has already been disposed",
];

const READ_ONLY_TOOLS = new Set([
  "list_pages",
  "wait_for",
  "take_snapshot",
  "take_screenshot",
  "list_console_messages",
  "get_console_message",
  "list_network_requests",
  "get_network_request",
  "get_css_styles",
  "performance_analyze_insight",
  "list_extensions",
  "list_webmcp_tools",
  "list_3p_developer_tools",
  "get_os_app_state",
  "get_heapsnapshot_summary",
  "get_heapsnapshot_details",
  "get_heapsnapshot_class_nodes",
  "get_heapsnapshot_retainers",
  "get_heapsnapshot_retaining_paths",
  "get_heapsnapshot_edges",
  "get_heapsnapshot_dominators",
  "get_heapsnapshot_object_details",
  "get_heapsnapshot_duplicate_strings",
  "compare_heapsnapshots",
  "query_heapsnapshot_objects",
  "analyze_heapsnapshot_contexts",
  "close_heapsnapshot",
]);

function isChromeError(text) {
  return Boolean(text) && CHROME_ERROR_PATTERNS.some((p) => text.includes(p));
}

function isMcpStaleStateError(text) {
  return Boolean(text) && MCP_STALE_STATE_PATTERNS.some((p) => text.includes(p));
}

function extractMessageTexts(msg) {
  const texts = [];
  if (msg?.error?.message) texts.push(msg.error.message);
  if (Array.isArray(msg?.result?.content)) {
    for (const item of msg.result.content) {
      if (item.type === "text" && typeof item.text === "string") texts.push(item.text);
    }
  }
  return texts.join("\n");
}

function responseHasChromeError(line) {
  try { return isChromeError(extractMessageTexts(JSON.parse(line))); } catch { return false; }
}

function responseHasStaleStateError(line) {
  try { return isMcpStaleStateError(extractMessageTexts(JSON.parse(line))); } catch { return false; }
}

async function closeChromeGracefully(pid) {
  if (!pid || !isProcessAlive(pid)) return;
  if (process.platform === "win32") {
    try { execFileSync("taskkill", ["/PID", String(pid), "/T"], { stdio: "ignore", windowsHide: true }); } catch {}
    const winDeadline = Date.now() + 2500;
    while (Date.now() < winDeadline) {
      if (!isProcessAlive(pid)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (isProcessAlive(pid)) {
      try { execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); } catch {}
    }
    return;
  }
  try { process.kill(pid, "SIGTERM"); } catch {}
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (isProcessAlive(pid)) {
    try { process.kill(pid, "SIGKILL"); } catch {}
  }
  try { process.kill(-pid, "SIGKILL"); } catch {}
}

async function startDaemonServer() {
  const idleOverrideIdx = process.argv.indexOf("--idle-timeout");
  const idleOverride = idleOverrideIdx !== -1 ? process.argv[idleOverrideIdx + 1] : undefined;
  const headlessOverride = process.argv.includes("--headed")
    ? false
    : process.argv.includes("--headless")
      ? true
      : undefined;

  const homeDir = getHomeDir(process.env);
  fs.mkdirSync(homeDir, { recursive: true, mode: 0o700 });
  const socketPath = getSocketPath(process.env);
  const statePath = getDaemonStatePath(process.env);

  const loaded = loadConfig({ env: process.env });
  const config = structuredClone(loaded.config);
  if (!config.browser) config.browser = {};
  if (idleOverride !== undefined) config.browser.idleTimeout = idleOverride;
  if (headlessOverride !== undefined) config.browser.headless = headlessOverride;

  const idleTimeoutMs = parseIdleTimeout(config.browser.idleTimeout);
  const idleTimeoutLabel =
    idleTimeoutMs === 0
      ? "never"
      : typeof config.browser.idleTimeout === "string"
        ? config.browser.idleTimeout
        : DEFAULT_IDLE_TIMEOUT;

  const browserMode = config.browser.browserUrl ? "direct" : "managed";
  const port = config.browser.debuggingPort || DEFAULT_PORT;
  const effectiveBrowserUrl = browserMode === "direct" ? config.browser.browserUrl : localBrowserUrl(port);

  const mcpInfo = resolveMcpPackage({ env: process.env });
  if (!mcpInfo) {
    throw new Error(
      "chrome-devtools-mcp runtime not found. Reinstall CLI with: npm i -g github:briqt/my-agent-browser --install-links"
    );
  }

  let previousState = null;
  try { previousState = JSON.parse(fs.readFileSync(statePath, "utf8")); } catch {}

  const startedAt = new Date().toISOString();
  let lastActivityAt = Date.now();
  let idleTimer = null;
  let shuttingDown = false;
  let inFlightCount = 0;

  let chromeReady = browserMode === "direct";
  let chromeLaunchPromise = null;
  let managedChromePid = null;
  let weLaunchedChrome = false;
  let relaunching = false;

  if (
    browserMode === "managed" &&
    previousState?.weLaunchedChrome &&
    previousState?.port === port &&
    isProcessAlive(previousState.browserPid)
  ) {
    managedChromePid = previousState.browserPid;
    weLaunchedChrome = true;
  }

  const pageOwners = new Map();
  const ownerActivity = new Map();
  const openSockets = new Set();

  let mcpSession = null;
  let mcpInitPromise = null;
  let rpcSerial = 0;
  const rpcWaiters = new Map();

  function writeDaemonState() {
    fs.mkdirSync(homeDir, { recursive: true, mode: 0o700 });
    const tmp = `${statePath}.${process.pid}.${randomUUID()}.tmp`;
    const data = {
      pid: process.pid,
      version: VERSION,
      startedAt,
      socketPath,
      configPath: loaded.exists ? loaded.configPath : null,
      browserMode,
      port: browserMode === "managed" ? port : null,
      browserUrl: effectiveBrowserUrl,
      browserPid: managedChromePid,
      weLaunchedChrome,
      idleTimeout: idleTimeoutLabel,
      idleTimeoutMs,
    };
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
    fs.renameSync(tmp, statePath);
  }

  function scheduleIdleTimer() {
    clearTimeout(idleTimer);
    idleTimer = null;
    if (shuttingDown || idleTimeoutMs <= 0 || inFlightCount > 0) return;
    const elapsed = Date.now() - lastActivityAt;
    const remaining = Math.max(100, idleTimeoutMs - elapsed);
    idleTimer = setTimeout(() => {
      if (inFlightCount > 0) {
        scheduleIdleTimer();
        return;
      }
      if (Date.now() - lastActivityAt >= idleTimeoutMs) {
        void shutdown();
      } else {
        scheduleIdleTimer();
      }
    }, remaining);
    idleTimer.unref?.();
  }

  function touchActivity(owner, toolName) {
    lastActivityAt = Date.now();
    if (owner) {
      const nowIso = new Date(lastActivityAt).toISOString();
      const existing = ownerActivity.get(owner);
      ownerActivity.set(owner, {
        owner,
        firstSeenAt: existing ? existing.firstSeenAt : nowIso,
        lastActivityAt: nowIso,
        lastTool: toolName || existing?.lastTool || "",
      });
    }
    scheduleIdleTimer();
  }

  async function ensureChromeReady() {
    if (browserMode === "direct") return;
    if (chromeReady && (await probePort(port, 1200))) return;
    if (chromeLaunchPromise) return chromeLaunchPromise;

    chromeLaunchPromise = (async () => {
      if (await probePort(port, 1500)) {
        chromeReady = true;
        writeDaemonState();
        return;
      }
      if (weLaunchedChrome && managedChromePid && isProcessAlive(managedChromePid)) {
        await closeChromeGracefully(managedChromePid);
      }
      const launched = launchChrome(config, port, process.env);
      const ready = await waitForPort(port, 12000);
      if (!ready || !isProcessAlive(launched.pid)) {
        if (isProcessAlive(launched.pid)) {
          await closeChromeGracefully(launched.pid);
        }
        throw new Error(`Chrome failed to start (port ${port} not reachable)`);
      }
      managedChromePid = launched.pid;
      weLaunchedChrome = true;
      chromeReady = true;
      writeDaemonState();
    })();

    try {
      await chromeLaunchPromise;
    } finally {
      chromeLaunchPromise = null;
    }
  }

  async function relaunchChrome() {
    if (browserMode !== "managed" || relaunching) return;
    relaunching = true;
    try {
      chromeReady = false;
      pageOwners.clear();
      await ensureChromeReady();
    } catch {}
    finally {
      relaunching = false;
    }
  }

  function createSessionInstance() {
    const args = buildMcpArgs(effectiveBrowserUrl);
    const childEnv = buildMcpEnv(process.env);
    const session = new McpSession({
      spawnChild: () =>
        spawn(process.execPath, [mcpInfo.binPath, ...args], {
          stdio: ["pipe", "pipe", "ignore"],
          env: childEnv,
          windowsHide: true,
        }),
      rewriteLine: (line) => rewriteClientRequest(line, config),
      shouldRecover: (line) => chromeReady && responseHasStaleStateError(line),
      log: () => {},
    });

    session.on("line", (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      if (msg.method) {
        if (msg.id != null && msg.method === "roots/list") {
          session.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { roots: [] } }));
        }
        return;
      }
      const waiter = rpcWaiters.get(msg.id);
      if (waiter) {
        rpcWaiters.delete(msg.id);
        waiter.resolve(msg);
      }
    });

    const resetSession = () => {
      if (mcpSession === session) {
        mcpSession = null;
        mcpInitPromise = null;
        for (const w of rpcWaiters.values()) {
          w.resolve({ error: { message: "Browser engine subprocess exited unexpectedly." } });
        }
        rpcWaiters.clear();
      }
    };
    session.on("exit", resetSession);
    session.on("error", resetSession);

    return session;
  }

  function sendMcpRpc(session, method, params) {
    const id = `d-${++rpcSerial}`;
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    rpcWaiters.set(id, { resolve });
    session.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return {
      id,
      promise,
      cancel: () => {
        rpcWaiters.delete(id);
        session.write(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "notifications/cancelled",
            params: { requestId: id, reason: "CLI client disconnected or timed out" },
          })
        );
      },
    };
  }

  async function ensureMcpSession() {
    if (mcpSession && !mcpInitPromise) return mcpSession;
    if (mcpInitPromise) return mcpInitPromise;

    mcpInitPromise = (async () => {
      const session = createSessionInstance();
      mcpSession = session;
      const initCall = sendMcpRpc(session, "initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "my-agent-browser-daemon", version: VERSION },
      });
      let initTimer;
      try {
        const initResp = await Promise.race([
          initCall.promise,
          new Promise((_, reject) => {
            initTimer = setTimeout(() => reject(new Error("Timed out initializing chrome-devtools-mcp")), 15000);
          }),
        ]);
        if (!initResp || initResp.error || !initResp.result) {
          throw new Error(initResp?.error?.message || "Failed to initialize chrome-devtools-mcp");
        }
        session.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }));
        return session;
      } catch (err) {
        initCall.cancel();
        session.end();
        if (mcpSession === session) mcpSession = null;
        throw err;
      } finally {
        clearTimeout(initTimer);
      }
    })();

    try {
      const s = await mcpInitPromise;
      mcpInitPromise = null;
      return s;
    } catch (err) {
      mcpInitPromise = null;
      throw err;
    }
  }

  function syncLivePagesFromStructured(structuredContent) {
    if (!structuredContent || typeof structuredContent !== "object") return null;
    if (structuredContent.reconnected) {
      pageOwners.clear();
    }
    if (Array.isArray(structuredContent.pages)) {
      const liveIds = new Set(structuredContent.pages.map((p) => p.id).filter((id) => Number.isFinite(id)));
      for (const knownId of pageOwners.keys()) {
        if (!liveIds.has(knownId)) pageOwners.delete(knownId);
      }
      return structuredContent.pages;
    }
    return null;
  }

  function fallbackPagesFromRegistry() {
    return [...pageOwners.values()].map((rec) => ({
      id: rec.pageId,
      url: "",
      title: "",
      selected: false,
    }));
  }

  async function fetchLivePagesIfActive() {
    if (browserMode === "managed" && !chromeReady) return [];
    if (browserMode === "managed" && !(await probePort(port, 1000))) {
      chromeReady = false;
      pageOwners.clear();
      return [];
    }
    if (browserMode === "direct" && !mcpSession) return [];
    try {
      const session = await ensureMcpSession();
      const call = sendMcpRpc(session, "tools/call", { name: "list_pages", arguments: {} });
      const resp = await Promise.race([
        call.promise,
        new Promise((resolve) => setTimeout(() => resolve(null), 3500)),
      ]);
      if (!resp || resp.error || resp.result?.isError) {
        return fallbackPagesFromRegistry();
      }
      const pages = syncLivePagesFromStructured(resp.result?.structuredContent);
      if (pages) return pages;
      const text = extractMessageTexts(resp);
      const parsed = [];
      for (const line of text.split("\n")) {
        const m = /^(\d+):\s*(.*?)\s*\(([^)]*)\)(\s*\[selected\])?/.exec(line.trim());
        if (m) parsed.push({ id: Number(m[1]), title: m[2], url: m[3], selected: Boolean(m[4]) });
      }
      const liveIds = new Set(parsed.map((p) => p.id));
      for (const knownId of pageOwners.keys()) {
        if (!liveIds.has(knownId)) pageOwners.delete(knownId);
      }
      return parsed;
    } catch {
      return fallbackPagesFromRegistry();
    }
  }

  function enrichPages(rawPages) {
    const now = Date.now();
    return rawPages.map((p) => {
      const rec = pageOwners.get(p.id);
      const lastTs = rec?.lastActivityAt ? Date.parse(rec.lastActivityAt) : null;
      return {
        pageId: p.id,
        url: p.url || "",
        title: p.title || "",
        selected: Boolean(p.selected),
        owner: rec?.owner || "",
        lastActivityAt: rec?.lastActivityAt || null,
        idleMs: lastTs ? Math.max(0, now - lastTs) : null,
        lastTool: rec?.lastTool || null,
      };
    });
  }

  function buildActiveOwners(enrichedPages) {
    const now = Date.now();
    const byOwner = new Map();
    for (const page of enrichedPages) {
      if (!page.owner) continue;
      if (!byOwner.has(page.owner)) {
        const meta = ownerActivity.get(page.owner);
        const lastTs = meta?.lastActivityAt
          ? Date.parse(meta.lastActivityAt)
          : page.lastActivityAt
            ? Date.parse(page.lastActivityAt)
            : now;
        byOwner.set(page.owner, {
          owner: page.owner,
          pageIds: [],
          lastActivityAt: new Date(lastTs).toISOString(),
          idleMs: Math.max(0, now - lastTs),
          lastTool: meta?.lastTool || page.lastTool || null,
        });
      }
      byOwner.get(page.owner).pageIds.push(page.pageId);
    }
    return [...byOwner.values()];
  }

  async function computeStopSafety(callerOwner = "") {
    const rawPages = await fetchLivePagesIfActive();
    const pages = enrichPages(rawPages);
    const activeOwners = buildActiveOwners(pages);
    const blockers = [];

    if (inFlightCount > 0) {
      blockers.push({ type: "in_flight", inFlightCount });
    }
    for (const entry of activeOwners) {
      if (entry.owner !== callerOwner) {
        blockers.push({
          type: "owner",
          owner: entry.owner,
          pageIds: entry.pageIds,
          idleMs: entry.idleMs,
        });
      }
    }

    let message = null;
    if (blockers.length > 0) {
      const parts = blockers.map((b) =>
        b.type === "in_flight"
          ? `${b.inFlightCount} command(s) currently running`
          : `owner '${b.owner}' holds page(s) [${b.pageIds.join(", ")}] (idle ${formatDuration(b.idleMs)})`
      );
      message =
        `Refusing to stop browser: ${parts.join("; ")}. ` +
        `Close only your own tab(s) with 'my-agent-browser close-page <pageId>' and let idle timeout close the browser, ` +
        `or pass --force for an explicit stop.`;
    }
    return { canStopSafely: blockers.length === 0, blockers, message, pages, activeOwners };
  }

  function assertPageOwner(pageId, callerOwner, force) {
    if (force) return;
    const rec = pageOwners.get(pageId);
    if (!rec || !rec.owner) return;
    if (rec.owner === (callerOwner || "")) return;
    throw new Error(
      `Page ${pageId} is owned by '${rec.owner}', caller is '${callerOwner || "unset"}'. ` +
      `Open your own tab with 'my-agent-browser open <url> --owner <your-name>', ` +
      `pass --owner '${rec.owner}' only if this is your tab, or pass --force for an explicit takeover.`
    );
  }

  function saveInlineImages(result) {
    if (!result || !Array.isArray(result.content)) return result;
    const nextContent = [];
    const savedImages = [];
    for (const item of result.content) {
      if (item && item.type === "image" && typeof item.data === "string") {
        let ext = ".png";
        if (item.mimeType === "image/jpeg" || item.mimeType === "image/jpg") ext = ".jpeg";
        else if (item.mimeType === "image/webp") ext = ".webp";
        const filePath = path.join(os.tmpdir(), `my-agent-browser-shot-${randomUUID()}${ext}`);
        fs.writeFileSync(filePath, Buffer.from(item.data, "base64"), { mode: 0o600 });
        savedImages.push({ filePath, mimeType: item.mimeType || "image/png" });
        nextContent.push({ type: "text", text: `Saved screenshot to ${filePath}.` });
      } else {
        nextContent.push(item);
      }
    }
    result.content = nextContent;
    if (savedImages.length > 0) {
      if (!result.structuredContent || typeof result.structuredContent !== "object") {
        result.structuredContent = {};
      }
      result.structuredContent.savedImages = savedImages;
    }
    return result;
  }

  async function handleRpc(req, onClientClose) {
    const method = req?.method;

    if (method === "ping") {
      return { ok: true, version: VERSION, pid: process.pid, shuttingDown };
    }

    if (shuttingDown) {
      return { ok: false, isError: true, error: "Browser daemon is shutting down" };
    }

    if (method === "status") {
      const callerOwner = req.callerOwner || "";
      const safety = await computeStopSafety(callerOwner);
      const idleMs = Math.max(0, Date.now() - lastActivityAt);
      return {
        ok: true,
        running: true,
        version: VERSION,
        pid: process.pid,
        startedAt,
        socketPath,
        configPath: loaded.exists ? loaded.configPath : null,
        browserMode,
        browserReady: browserMode === "direct" ? Boolean(mcpSession) : chromeReady,
        browserPid: managedChromePid,
        weLaunchedChrome,
        port: browserMode === "managed" ? port : null,
        browserUrl: effectiveBrowserUrl,
        mcpVersion: mcpInfo.version,
        mcpPath: mcpInfo.binPath,
        idleTimeout: idleTimeoutLabel,
        idleTimeoutMs,
        idleMs,
        willAutoCloseAt: idleTimeoutMs > 0 ? new Date(lastActivityAt + idleTimeoutMs).toISOString() : null,
        inFlightCount,
        pages: safety.pages,
        activeOwners: safety.activeOwners,
        canStopSafely: safety.canStopSafely,
        stopBlockers: safety.blockers,
      };
    }

    if (method === "stop") {
      const callerOwner = req.callerOwner || "";
      const force = req.force === true;
      const safety = await computeStopSafety(callerOwner);
      if (!safety.canStopSafely && !force) {
        return { ok: false, isError: true, blocked: true, blockers: safety.blockers, error: safety.message };
      }
      const willCloseBrowser = Boolean(browserMode === "managed" && weLaunchedChrome && managedChromePid);
      setImmediate(() => { void shutdown(); });
      return { ok: true, stopped: true, closedManagedBrowser: willCloseBrowser };
    }

    if (method === "list_tools") {
      touchActivity(req.callerOwner || "", "list_tools");
      const session = await ensureMcpSession();
      const tools = [];
      let cursor;
      for (let i = 0; i < 20; i++) {
        const call = sendMcpRpc(session, "tools/list", cursor ? { cursor } : {});
        const resp = await call.promise;
        if (!resp || resp.error || !Array.isArray(resp.result?.tools)) {
          throw new Error(resp?.error?.message || "Failed to list tools from chrome-devtools-mcp");
        }
        tools.push(...resp.result.tools);
        cursor = resp.result.nextCursor;
        if (!cursor) break;
      }
      return { ok: true, tools };
    }

    if (method === "claim") {
      const pageId = req.pageId;
      const owner = req.owner || "";
      const force = req.force === true;
      if (!Number.isSafeInteger(pageId) || pageId < 0) throw new Error("pageId must be a nonnegative integer");
      if (!owner) throw new Error("claim requires --owner <name> (or MY_AGENT_BROWSER_OWNER)");
      touchActivity(owner, "claim");
      await ensureChromeReady();
      await ensureMcpSession();
      const rawPages = await fetchLivePagesIfActive();
      if (!rawPages.some((p) => p.id === pageId)) {
        throw new Error(`Page ${pageId} not found. Run 'my-agent-browser pages' to list open tabs.`);
      }
      assertPageOwner(pageId, owner, force);
      const nowIso = new Date().toISOString();
      const prev = pageOwners.get(pageId);
      pageOwners.set(pageId, {
        pageId,
        owner,
        createdAt: prev?.createdAt || nowIso,
        lastActivityAt: nowIso,
        lastTool: "claim",
      });
      return { ok: true, pageId, owner };
    }

    if (method === "release") {
      const pageId = req.pageId;
      const callerOwner = req.callerOwner || "";
      const force = req.force === true;
      if (!Number.isSafeInteger(pageId) || pageId < 0) throw new Error("pageId must be a nonnegative integer");
      touchActivity(callerOwner, "release");
      assertPageOwner(pageId, callerOwner, force);
      const prev = pageOwners.get(pageId);
      if (prev) prev.owner = "";
      return { ok: true, pageId, owner: "" };
    }

    if (method === "call_tool") {
      const name = req.name;
      const args = req.arguments && typeof req.arguments === "object" ? req.arguments : {};
      const callerOwner = req.callerOwner || "";
      const lockOwner = req.lockOwner || "";
      const force = req.force === true;

      if (typeof name !== "string" || !name) throw new Error("Tool name is required");
      if (name === "evaluate_script" && args.serviceWorkerId === undefined && (!Number.isSafeInteger(args.pageId) || args.pageId < 0)) {
        throw new Error("evaluate_script requires numeric pageId (or --service-worker-id)");
      }

      inFlightCount++;
      touchActivity(callerOwner || lockOwner, name);
      try {
        const isBrowserlessHeapTool =
          name.startsWith("get_heapsnapshot_") ||
          name === "compare_heapsnapshots" ||
          name === "query_heapsnapshot_objects" ||
          name === "analyze_heapsnapshot_contexts" ||
          name === "close_heapsnapshot";

        if (!isBrowserlessHeapTool) {
          await ensureChromeReady();
        }
        const session = await ensureMcpSession();

        if (args.pageId !== undefined && args.pageId !== null && !READ_ONLY_TOOLS.has(name)) {
          assertPageOwner(args.pageId, callerOwner, force);
        }

        const preExistingIds = name === "new_page" ? new Set(pageOwners.keys()) : null;

        const call = sendMcpRpc(session, "tools/call", { name, arguments: args });
        onClientClose(() => call.cancel());
        const resp = await call.promise;

        const rawLine = JSON.stringify(resp);
        if (browserMode === "managed" && chromeReady && responseHasChromeError(rawLine)) {
          const alive = await probePort(port, 1500);
          if (!alive) {
            void relaunchChrome();
            return {
              ok: false,
              isError: true,
              error:
                "Chrome was closed or crashed and is being relaunched. Refresh page IDs with 'my-agent-browser pages', navigate again, and verify any previous mutation before retrying.",
            };
          }
        }

        if (resp.error) {
          return { ok: false, isError: true, error: resp.error.message || "Tool call failed" };
        }

        const result = saveInlineImages(resp.result || {});
        const isError = Boolean(result.isError);
        const nowIso = new Date().toISOString();

        const livePages = syncLivePagesFromStructured(result.structuredContent);
        let openedId;
        let openedPage;

        if (name === "new_page") {
          openedId = Array.isArray(livePages)
            ? (livePages.find((p) => p.selected && (!preExistingIds || !preExistingIds.has(p.id)))?.id ??
               livePages.find((p) => p.selected)?.id)
            : undefined;
          if (!Number.isFinite(openedId) && !isError) {
            const text = (result.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
            const m = /^(\d+):.*\[selected\]/m.exec(text);
            if (m) openedId = Number(m[1]);
          }
          if (Number.isFinite(openedId)) {
            pageOwners.set(openedId, {
              pageId: openedId,
              owner: lockOwner,
              createdAt: nowIso,
              lastActivityAt: nowIso,
              lastTool: "new_page",
            });
            const pageInfo = Array.isArray(livePages) ? livePages.find((p) => p.id === openedId) : null;
            openedPage = {
              pageId: openedId,
              url: pageInfo?.url || args.url || "",
              title: pageInfo?.title || "",
              owner: lockOwner,
            };
          }
        } else if (!isError && name === "close_page" && Number.isFinite(args.pageId)) {
          if (!Array.isArray(livePages) || !livePages.some((p) => p.id === args.pageId)) {
            pageOwners.delete(args.pageId);
          } else {
            // Release ownership when Chrome prevents closing the last remaining tab so stop/restart is not blocked.
            const prev = pageOwners.get(args.pageId);
            if (prev) prev.owner = "";
          }
        } else if (!isError && Number.isFinite(args.pageId)) {
          const prev = pageOwners.get(args.pageId);
          const skipThirdPartyReadTouch = Boolean(prev?.owner && READ_ONLY_TOOLS.has(name) && callerOwner !== prev.owner);
          if (!skipThirdPartyReadTouch) {
            pageOwners.set(args.pageId, {
              pageId: args.pageId,
              owner: prev?.owner || "",
              createdAt: prev?.createdAt || nowIso,
              lastActivityAt: nowIso,
              lastTool: name,
            });
          }
        }

        let enrichedPages;
        if (name === "list_pages" && Array.isArray(livePages)) {
          enrichedPages = enrichPages(livePages);
        }

        const text = (result.content || [])
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("\n");

        return {
          ok: !isError,
          isError,
          ...(isError ? { error: text || "Tool returned an error" } : {}),
          text,
          structuredContent: result.structuredContent || null,
          ...(Number.isFinite(openedId) ? { pageId: openedId } : {}),
          ...(openedPage ? { openedPage } : {}),
          ...(enrichedPages ? { pages: enrichedPages } : {}),
        };
      } finally {
        inFlightCount = Math.max(0, inFlightCount - 1);
        lastActivityAt = Date.now();
        scheduleIdleTimer();
      }
    }

    return { ok: false, isError: true, error: `Unknown daemon method: ${String(method)}` };
  }

  let server;
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    clearTimeout(idleTimer);
    // Stop engine and managed Chrome before closing the socket so waitForDaemonExit sees freed locks/ports.
    try { mcpSession?.end(); } catch {}
    if (browserMode === "managed" && weLaunchedChrome && managedChromePid) {
      await closeChromeGracefully(managedChromePid);
    }
    for (const sock of openSockets) {
      try { sock.destroy(); } catch {}
    }
    openSockets.clear();
    try {
      if (server) {
        await new Promise((resolve) => server.close(() => resolve()));
      }
    } catch {}
    if (process.platform !== "win32") {
      try { fs.unlinkSync(socketPath); } catch {}
    }
    try {
      const current = JSON.parse(fs.readFileSync(statePath, "utf8"));
      if (current && current.pid === process.pid) fs.unlinkSync(statePath);
    } catch {}
    process.exit(0);
  }

  if (process.platform !== "win32") {
    try { fs.unlinkSync(socketPath); } catch {}
  }

  server = net.createServer((socket) => {
    openSockets.add(socket);
    const decoder = new StringDecoder("utf8");
    let partial = "";
    let handled = false;
    const closeCallbacks = [];
    const readTimer = setTimeout(() => {
      if (!handled) socket.destroy();
    }, 10_000);
    readTimer.unref?.();

    socket.on("close", () => {
      clearTimeout(readTimer);
      openSockets.delete(socket);
      for (const cb of closeCallbacks) {
        try { cb(); } catch {}
      }
    });
    socket.on("error", () => {});
    socket.on("data", (chunk) => {
      if (handled) return;
      partial += decoder.write(Buffer.from(chunk));
      const idx = partial.indexOf("\n");
      if (idx === -1) return;
      handled = true;
      clearTimeout(readTimer);
      const line = partial.slice(0, idx);
      (async () => {
        let reply;
        try {
          const req = JSON.parse(line);
          reply = await handleRpc(req, (cb) => closeCallbacks.push(cb));
        } catch (err) {
          reply = { ok: false, isError: true, error: err.message || String(err) };
        }
        if (!socket.destroyed) {
          socket.end(JSON.stringify(reply) + "\n");
        }
      })();
    });
  });

  const oldUmask = process.platform !== "win32" ? process.umask(0o077) : null;
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => {
        if (process.platform !== "win32") {
          try { fs.chmodSync(socketPath, 0o600); } catch {}
        }
        resolve();
      });
    });
  } finally {
    if (oldUmask !== null) process.umask(oldUmask);
  }

  writeDaemonState();
  scheduleIdleTimer();

  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) {
    process.on(sig, () => { void shutdown(); });
  }
  process.on("uncaughtException", () => { void shutdown(); });
  process.on("unhandledRejection", () => { void shutdown(); });

  if (typeof process.send === "function") {
    process.send({ ready: true, pid: process.pid, socketPath });
  }
}

if (require.main === module) {
  startDaemonServer().catch((err) => {
    if (typeof process.send === "function") {
      try { process.send({ ready: false, error: err.message || String(err) }); } catch {}
    } else {
      process.stderr.write(`[my-agent-browser daemon] ${err.message || err}\n`);
    }
    process.exit(1);
  });
}

module.exports = { startDaemonServer };
