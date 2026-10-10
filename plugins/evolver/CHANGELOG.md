# Changelog

All notable changes to the Evolver WorkBuddy plugin are documented here.
This project follows Semantic Versioning.

## [Unreleased]

## [0.2.0] - 2026-10-10

### Added
- `SessionStart` hook (`hooks/hooks.json` → `hooks/session-start.mjs`) that probes the
  local Proxy and injects `hookSpecificOutput.additionalContext`: tool liveness,
  Recipe-first guidance, and a pending-claim hint. Zero dependencies, fails open.
- `UserPromptSubmit` hook (`hooks/user-prompt-submit.mjs`) that recalls by text
  through Proxy `/asset/fetch` (no `limit`, so the Proxy default of 2 applies)
  and injects one asset's complete strategy as an `[Evolution Memory]` block,
  matching evolver-dsh-plugin: 4+ steps, at most 4000 strategy characters
  (steps are never truncated, unlike dsh), per-session dedupe, input gate
  (slash commands, acknowledgements, <8 chars), 5s recall budget, fails open.
- MCP tool `evolver_asset_reuse_result` (Proxy `/asset/reuse-result`), which the
  injected block asks the agent to call after reuse.

### Changed
- MCP bridge is Recipe-first: `evolver_recipe_search` then `evolver_recipe_express`
  against Proxy `/recipe/search` and `/recipe/express`. `evolver_search_assets`
  remains as Gene/Capsule fallback when no Recipe hits.

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

