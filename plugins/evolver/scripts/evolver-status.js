#!/usr/bin/env node
"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function run(cmd, args = []) {
  try {
    return {
      ok: true,
      value: execFileSync(cmd, args, {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      }).trim()
    };
  } catch (error) {
    const stderr = error.stderr ? String(error.stderr).trim() : "";
    return { ok: false, value: stderr || error.message };
  }
}

function printCheck(label, result) {
  const mark = result.ok ? "OK" : "MISSING";
  console.log(`${mark} ${label}: ${result.value || "(no output)"}`);
}

const nodeVersion = { ok: true, value: process.version };
const gitVersion = run("git", ["--version"]);
const evolverPath = run("sh", ["-lc", "command -v evolver"]);
const evolverHelp = evolverPath.ok ? run("evolver", ["--help"]) : { ok: false, value: "evolver CLI not found" };
const gitRoot = run("git", ["rev-parse", "--show-toplevel"]);
const proxySettings = path.join(os.homedir(), ".evolver", "settings.json");

console.log("Evolver WorkBuddy plugin status");
console.log(`cwd: ${process.cwd()}`);
printCheck("Node.js", nodeVersion);
printCheck("Git", gitVersion);
printCheck("Evolver CLI", evolverPath);
printCheck("Git workspace", gitRoot);

if (evolverHelp.ok) {
  const firstLine = evolverHelp.value.split(/\r?\n/).find(Boolean) || "help output available";
  console.log(`OK Evolver help: ${firstLine}`);
} else {
  console.log(`MISSING Evolver help: ${evolverHelp.value}`);
}

console.log(`INFO EVOLVE_STRATEGY: ${process.env.EVOLVE_STRATEGY || "balanced (default)"}`);
console.log(`INFO A2A_HUB_URL: ${process.env.A2A_HUB_URL || "(offline/default)"}`);
console.log(`INFO A2A_NODE_ID: ${process.env.A2A_NODE_ID ? "(set)" : "(blank — auto-config on first run)"}`);
console.log(`INFO Proxy settings: ${fs.existsSync(proxySettings) ? proxySettings : "(not found)"}`);

// Plain-language network/claim state. Fail-safe: never throw, never print
// raw JSON, node secrets, stake, or hub_rotate internals.
try {
  const claimUrlPath = path.join(os.homedir(), ".evomap", "claim_url");
  if (fs.existsSync(claimUrlPath)) {
    const claimUrl = fs.readFileSync(claimUrlPath, "utf8").trim();
    console.log("");
    console.log("INFO Network: node registered but NOT YET CLAIMED.");
    console.log("     To connect, sign in to https://evomap.ai and open this link:");
    console.log(`     ${claimUrl}`);
    console.log("     That's the only step — no id or secret to find. Local memory works regardless.");
  } else {
    console.log("INFO Network: local memory works with zero config; no pending claim link.");
    console.log("     To connect (optional): leave A2A_NODE_ID blank, run 'evolver' once to print a claim link.");
  }
} catch (_error) {
  console.log("INFO Network: could not read claim state; local memory works regardless.");
}

if (!evolverPath.ok) {
  console.log("NEXT install with: npm install -g @evomap/evolver");
} else if (!gitRoot.ok) {
  console.log("NEXT run Evolver from inside a git-initialized workspace.");
} else {
  console.log("NEXT try: /evolver-status, /evolver-search, or evolver --review");
}

