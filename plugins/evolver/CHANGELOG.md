# Changelog

All notable changes to the Evolver WorkBuddy plugin are documented here.
This project follows Semantic Versioning.

## [Unreleased]

### Added
- Automatic reuse reports. The `Stop` hook reports every strategy the plugin
  injected through Proxy `POST /asset/reuse-result` as
  `{asset_id, outcome, task_id, reason, evidence}`, with evidence read off the
  turn's transcript: the last test/build/lint/type-check (exit code and output,
  `fail_then_pass` with output pipes ignored) and whether the strategy's steps
  show up in the turn's commands, paths, written code and answer. A turn with
  nothing to compare goes out as tier `none` with `applied: partial`.
- Follow-up reports: the next prompt's correction or approval (`:correction`,
  L3) and, at the next session in the same project, whether the edited files
  were kept or reverted (`:retention`, L2). A `PreToolUse` hook on edit tools
  hashes each file before its first edit.
- A delivery queue drained by a detached worker and kept for 8 days:
  `recorded`, `duplicate_report` and ineligible answers are final, terminal or
  invalid requests are settled as rejected, everything else is retried.
- Automatic Evolver setup: at session start a detached worker installs or
  upgrades `@evomap/evolver` (2.0.44 or newer) into the plugin data folder and
  starts its Proxy with `evolver lifecycle start`, under a cross-process lock,
  with backoff on failure. The outcome reaches the session context.
- `/evolver-status` shows the engine setup and the latest report deliveries
  (`eligible`, `counted`, `weight`) and rejections.

### Fixed
- `EVOMAP_PROXY_PORT` must be a port number (1–65535); anything else falls back
  to 19820, so it can no longer point the Proxy URL at another host. Proxy
  requests refuse redirects.
- A test summary like `1 failed, 0 errors` reads as a failure; only zero
  counts are ignored.
- Questions such as `这个方案不行吗？` are no longer sent as corrections.
- A report counts as delivered only on `recorded: true` or `duplicate_report`;
  a `terminal: true` answer is rejected whatever its HTTP status.
- Stop queues reports before marking them reported; queue, retention and
  edit files are claimed until committed and recovered after a crash; locks
  carry an owner token; the report drain refreshes its lock after every
  attempt and merges only what it attempted.
- A prerelease of the minimum Evolver version does not satisfy it; an upgrade
  whose restart leaves the old Proxy running reports `restart_needed`; an
  unexpected setup error is recorded and backed off instead of retried at
  every session, and no longer stops the report drain.
- A transcript rewritten since the prompt (checked by a fingerprint of the
  bytes before the turn's start) is read from the last user message.
- Overlapping prompts in one session no longer roll the session back or inject
  the same strategy twice.
- Environment-style secret names (`OPENAI_API_KEY=…`) are redacted before
  recall.
- The hook stdin watchdog waits up to 3s for a payload that is still arriving,
  then answers anyway.
- A running Proxy that reports no version is not taken as meeting the minimum.
- Quoted multi-word secrets are redacted whole; camelCase identifiers such as
  `cancellationToken` are left alone.

### Changed
- `evolver_asset_reuse_result` sends self-reported `L5` evidence.
- `scripts/evolver-status.js` became `scripts/evolver-status.mjs`; the injection
  dedupe state moved from `recall-state.json` to per-session files.
- Start hints now name `evolver lifecycle start` instead of running `evolver`
  inside a git repo.

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

