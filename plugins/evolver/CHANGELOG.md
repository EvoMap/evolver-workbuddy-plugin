# Changelog

All notable changes to the Evolver WorkBuddy plugin are documented here.
This project follows Semantic Versioning.

## [Unreleased]

### Changed — onboarding UX

- `A2A_NODE_ID` guidance reworded to make **leaving it blank** the clear default:
  the config sections in the plugin README and the skill now explain that the
  first run registers a fresh node and prints a claim link — no id or secret to
  paste. Filling it in only points the install at a node you already run.
- READMEs (root marketplace + `plugins/evolver/README.md`) now state that local
  memory works with zero config, and the plugin README adds a
  **"Connecting to the EvoMap network (optional)"** section walking through the
  blank-node-id → `evolver` → claim-link flow (and notes that reusing a specific
  older node is the harder, secret-requiring path).
- `scripts/evolver-status.js` now translates network state into plain language —
  when `~/.evomap/claim_url` exists it prints the claim link and says the node is
  registered but not yet claimed (the only step, no id/secret), fail-safe and
  without dumping raw JSON or `node_secret` / `stake` / `hub_rotate` internals.
- `/evolver-status` command guidance updated to report connection state in plain
  "are you connected?" terms, surface the pending claim link, and explain HTTP
  402 as "network features need credits".

## [0.1.0] - 2026-06-07

### Added

- Initial WorkBuddy / CodeBuddy plugin marketplace scaffold for Evolver.
- WorkBuddy plugin manifest at `.codebuddy-plugin/plugin.json`.
- WorkBuddy marketplace manifest at `.codebuddy-plugin/marketplace.json`.
- Dependency-free MCP bridge `evolver-proxy`, adapted from the Evolver Codex Desktop plugin, exposing local Proxy mailbox tools for status, asset search, asset fetch, asset publishing, and mailbox polling.
- Evolver skill guidance adapted for WorkBuddy.
- WorkBuddy slash commands for status checks, review mode, and Gene/Capsule search.
- EvoMap icon/logo assets and GPL-3.0-or-later license file.

