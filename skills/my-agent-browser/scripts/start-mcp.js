#!/usr/bin/env node
"use strict";

// Legacy MCP migration stub for my-agent-browser v2.0+.
// Keeps existing v1.x MCP configurations from crashing at agent startup while
// consuming virtually zero context and instructing the agent/user to remove
// this obsolete MCP server entry and switch to the my-agent-browser CLI.

const STUB_VERSION = "2.0.0";
const DEPRECATION_NOTICE =
  "my-agent-browser v2.0+ no longer uses MCP — it is now a standalone CLI ('my-agent-browser') with zero context overhead. " +
  "Action required: (1) Install or update the CLI with 'npm i -g github:briqt/my-agent-browser --install-links'; " +
  "(2) Update the skill with 'npx skills add briqt/my-agent-browser -g -y'; " +
  "(3) Remove this legacy MCP server entry pointing to start-mcp.js using your agent's own MCP settings, " +
  "and drive the browser via the 'my-agent-browser' CLI.";

const DEPRECATION_TOOL = {
  name: "my_agent_browser_mcp_deprecated",
  description:
    "DEPRECATED in my-agent-browser v2.0: Browser control moved to the 'my-agent-browser' CLI. " +
    "Remove this legacy MCP server entry in your agent's own MCP configuration, ensure the CLI is installed " +
    "('npm i -g github:briqt/my-agent-browser --install-links'), and use the my-agent-browser skill.",
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
};

process.stdout.on("error", () => process.exit(0));
process.stdin.on("error", () => process.exit(0));

const ONE_SHOT_FLAGS = new Set(["--help", "-h", "--version", "-v", "--doctor", "--init-config", "--check-update"]);
const cliFlags = process.argv.slice(2);
if (cliFlags.some((f) => ONE_SHOT_FLAGS.has(f))) {
  process.stderr.write(`[my-agent-browser] ${DEPRECATION_NOTICE}\n`);
  if (cliFlags.includes("--version") || cliFlags.includes("-v")) {
    console.log(STUB_VERSION);
  } else if (cliFlags.includes("--json")) {
    console.log(JSON.stringify({ deprecated: true, version: STUB_VERSION, message: DEPRECATION_NOTICE }));
  }
  process.exit(0);
}

process.stderr.write(`[my-agent-browser] Legacy MCP entry started. ${DEPRECATION_NOTICE}\n`);

let useContentLength = false;
let rawBuffer = Buffer.alloc(0);

function sendReply(payload) {
  const json = JSON.stringify(payload);
  if (useContentLength) {
    const byteLen = Buffer.byteLength(json, "utf8");
    process.stdout.write(`Content-Length: ${byteLen}\r\n\r\n${json}`);
  } else {
    process.stdout.write(json + "\n");
  }
}

function handleMessage(msg) {
  if (!msg || typeof msg !== "object" || msg.id === undefined || msg.id === null || !msg.method) return;

  if (msg.method === "initialize") {
    const protocolVersion = typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : "2024-11-05";
    sendReply({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "my-agent-browser-legacy-mcp-stub", version: STUB_VERSION },
        instructions: DEPRECATION_NOTICE,
      },
    });
    return;
  }

  if (msg.method === "ping") {
    sendReply({ jsonrpc: "2.0", id: msg.id, result: {} });
    return;
  }

  if (msg.method === "tools/list") {
    sendReply({ jsonrpc: "2.0", id: msg.id, result: { tools: [DEPRECATION_TOOL] } });
    return;
  }

  if (msg.method === "resources/list") {
    sendReply({ jsonrpc: "2.0", id: msg.id, result: { resources: [] } });
    return;
  }

  if (msg.method === "resources/templates/list") {
    sendReply({ jsonrpc: "2.0", id: msg.id, result: { resourceTemplates: [] } });
    return;
  }

  if (msg.method === "prompts/list") {
    sendReply({ jsonrpc: "2.0", id: msg.id, result: { prompts: [] } });
    return;
  }

  if (msg.method === "tools/call") {
    sendReply({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        isError: true,
        content: [{ type: "text", text: DEPRECATION_NOTICE }],
      },
    });
    return;
  }

  sendReply({
    jsonrpc: "2.0",
    id: msg.id,
    error: { code: -32601, message: DEPRECATION_NOTICE },
  });
}

function drainBuffer() {
  for (;;) {
    // Skip leading CR/LF whitespace between frames
    let start = 0;
    while (start < rawBuffer.length && (rawBuffer[start] === 0x0d || rawBuffer[start] === 0x0a || rawBuffer[start] === 0x20)) {
      start++;
    }
    if (start > 0) rawBuffer = rawBuffer.subarray(start);
    if (rawBuffer.length === 0) return;

    const head = rawBuffer.subarray(0, Math.min(rawBuffer.length, 32)).toString("ascii");
    if (/^Content-Length:/i.test(head)) {
      useContentLength = true;
      const sepIdx = rawBuffer.indexOf("\r\n\r\n");
      if (sepIdx === -1) return;
      const headerText = rawBuffer.subarray(0, sepIdx).toString("ascii");
      const m = /Content-Length:\s*(\d+)/i.exec(headerText);
      if (!m) {
        rawBuffer = rawBuffer.subarray(sepIdx + 4);
        continue;
      }
      const bodyLen = Number(m[1]);
      const frameEnd = sepIdx + 4 + bodyLen;
      if (rawBuffer.length < frameEnd) return;
      const bodyText = rawBuffer.subarray(sepIdx + 4, frameEnd).toString("utf8");
      rawBuffer = rawBuffer.subarray(frameEnd);
      try { handleMessage(JSON.parse(bodyText)); } catch {}
      continue;
    }

    const nlIdx = rawBuffer.indexOf(0x0a);
    if (nlIdx === -1) return;
    const line = rawBuffer.subarray(0, nlIdx).toString("utf8").trim();
    rawBuffer = rawBuffer.subarray(nlIdx + 1);
    if (!line) continue;
    try { handleMessage(JSON.parse(line)); } catch {}
  }
}

process.stdin.on("data", (chunk) => {
  rawBuffer = Buffer.concat([rawBuffer, Buffer.from(chunk)]);
  drainBuffer();
});

process.stdin.on("end", () => {
  if (rawBuffer.length > 0) {
    try { handleMessage(JSON.parse(rawBuffer.toString("utf8").trim())); } catch {}
  }
  process.exit(0);
});
