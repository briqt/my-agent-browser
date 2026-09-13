#!/usr/bin/env node
"use strict";

// Migrate an existing config.json to the v1.1.0 recommendations.
//
//   node migrate-config.js            # show what would change
//   node migrate-config.js --apply    # write it, after backing the file up
//
// Idempotent: running it on an already-migrated config reports no changes.

const fs = require("fs");
const os = require("os");
const path = require("path");

const SKILL_NAME = "my-agent-browser";
const configDir =
  process.env.MY_AGENT_BROWSER_HOME ||
  path.join(os.homedir(), ".config", "agent-skills", SKILL_NAME);
const configFile = path.join(configDir, "config.json");

// Each of these was measured to hurt more than it helps — see references/anti-detection.md.
const REMOVE = new Map([
  [
    "--disable-blink-features=AutomationControlled",
    "no effect on navigator.webdriver here, and it triggers Chrome's warning bar (~52px of viewport)",
  ],
  [
    "--disable-gpu",
    "makes getContext('webgl') return null; no WebGL at all is a stronger bot signal than any renderer string",
  ],
  [
    "--hide-scrollbars",
    "reports scrollbar width 0, which no real Chrome does (headless included)",
  ],
]);

const apply = process.argv.includes("--apply");

function main() {
  if (!fs.existsSync(configFile)) {
    console.log(`No config at ${configFile} — nothing to migrate.`);
    return 0;
  }

  const raw = fs.readFileSync(configFile, "utf-8");
  let config;
  try {
    config = JSON.parse(raw);
  } catch (e) {
    console.error(`Could not parse ${configFile}: ${e.message}`);
    return 1;
  }

  const changes = [];

  const browser = config.browser || {};
  const extraArgs = Array.isArray(browser.extraArgs) ? browser.extraArgs : [];
  const kept = extraArgs.filter((arg) => {
    const reason = REMOVE.get(arg);
    if (!reason) return true;
    changes.push(`remove ${arg}\n    ${reason}`);
    return false;
  });

  if (!config.stealth) {
    changes.push(
      "add stealth.evaluateScript = true\n    " +
      "keeps the MCP install path (which contains your username) out of page-visible stack traces",
    );
  }

  if (changes.length === 0) {
    console.log("Config is already up to date.");
    return 0;
  }

  console.log(`Config: ${configFile}\n`);
  for (const c of changes) console.log(`  - ${c}`);

  // Anything that removed --disable-gpu should confirm WebGL actually came back.
  const hasSwiftshader = kept.some((a) => a.includes("swiftshader"));
  const hasIgnoreBlocklist = kept.includes("--ignore-gpu-blocklist");
  if (!hasSwiftshader && !hasIgnoreBlocklist) {
    console.log(
      "\nAfter applying, check that WebGL works on this host — evaluate:\n" +
      "  () => { const gl = document.createElement('canvas').getContext('webgl');\n" +
      "          if (!gl) return 'NO WEBGL';\n" +
      "          const d = gl.getExtension('WEBGL_debug_renderer_info');\n" +
      "          return gl.getParameter(d.UNMASKED_RENDERER_WEBGL); }\n" +
      "If it returns 'NO WEBGL', add --ignore-gpu-blocklist to extraArgs; if that is\n" +
      "still not enough, add --enable-unsafe-swiftshader.",
    );
  }

  if (!apply) {
    console.log("\nDry run. Re-run with --apply to write these changes.");
    return 0;
  }

  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15);
  const backup = `${configFile}.bak-${stamp}`;
  fs.writeFileSync(backup, raw);

  config.browser = { ...browser, extraArgs: kept };
  if (!config.stealth) config.stealth = { evaluateScript: true, sourceUrl: "eval.js" };
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + "\n");

  console.log(`\nApplied. Backup written to ${backup}`);
  console.log("Restart your agent session for the new config to take effect.");
  return 0;
}

process.exit(main());
