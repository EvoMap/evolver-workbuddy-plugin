# Evolver — WorkBuddy / CodeBuddy plugin

Self-evolution workflows for WorkBuddy, powered by [Evolver](https://github.com/EvoMap/evolver) (`@evomap/evolver`) and [EvoMap](https://evomap.ai).

This plugin packages Evolver as a WorkBuddy-ready workflow: a model-invoked skill, SessionStart / UserPromptSubmit hooks, slash commands, a local status helper, and an MCP bridge to the Evolver Proxy mailbox for Genes and Capsules.

## What It Does

| Layer | Mechanism | Behavior |
| --- | --- | --- |
| Engine setup | SessionStart hook + background worker | Makes sure this machine has a running Evolver Proxy of at least the required version: installs or upgrades `@evomap/evolver` into the plugin's data folder (never `npm -g`, never `sudo`) and starts it with `evolver lifecycle start`, all in a detached process so the hook stays within its timeout. See [Automatic Evolver setup](#automatic-evolver-setup). |
| Session context | SessionStart hook | On startup, resume, clear, and compact, probes the local Proxy and injects a short `additionalContext` note: whether `evolver_*` tools are live, what the engine setup did or why it failed (with the manual fix), Recipe-first guidance, and a pending-claim hint. Fails open with `{}`. |
| Prompt recall | UserPromptSubmit hook | Recalls by text through Proxy `/asset/fetch` (no ids, no `limit`: the Proxy default of 2 candidates) and injects one asset's complete strategy as an `[Evolution Memory]` block. Picks the best-scored asset with 4+ steps and at most 4000 strategy characters, each only once per session. Skips slash commands, acknowledgements, and prompts under 8 characters. 5s recall budget; fails open with `{}`. |
| Reuse reports | Stop, UserPromptSubmit, PreToolUse and SessionStart hooks | Reports every injected strategy to the Hub through Proxy `POST /asset/reuse-result`, with evidence read off the turn: the last test/build/lint/type-check, whether the strategy's steps show up in the turn's commands, paths, written code and answer, the next prompt's correction or approval, and whether the next session still has the edited files. See [Reuse reports](#reuse-reports). |
| Passive recall | Skill guidance | Guides WorkBuddy to check local memory, reusable Genes, and relevant Capsules before substantive changes. |
| Network bridge | MCP server `evolver-proxy` | Exposes Recipe-first `evolver_recipe_search` / `evolver_recipe_express`, then fallback `evolver_search_assets`, plus `evolver_status`, `evolver_fetch_asset`, `evolver_asset_reuse_result`, `evolver_publish_asset`, `evolver_distill_conversation`, and `evolver_poll` through the local EvoMap Proxy mailbox. |
| Quick entry | Slash commands | Adds `/evolver-status`, `/evolver-review`, and `/evolver-search` for common workflows. |
| Active control | CLI workflow | Guides WorkBuddy through `evolver`, `evolver --review`, `evolver --loop`, and strategy presets. |
| Safety boundary | Git + review | Evolver emits protocol-bound GEP prompts and audit events; WorkBuddy should not auto-apply generated output unless the user asks. |

## Prerequisites

- Node.js 18 or newer for the plugin's hooks; Evolver itself needs Node.js 22.13 or newer (WorkBuddy bundles Node.js 22).
- Git.
- Network access to the npm registry the first time, so the plugin can install Evolver.

## Configure

Evolver works offline by default — **local memory needs zero configuration**: no
account, no key, no node id. The steps below only matter if you also want to
connect to the EvoMap network (see [below](#connecting-to-the-evomap-network-optional)).

Hub features use project-local environment variables:

```bash
A2A_HUB_URL=https://evomap.ai
A2A_NODE_ID=
```

About `A2A_NODE_ID`: Leave this blank (recommended). On first run the local Proxy
registers a fresh node for you and prints a link to claim it on evomap.ai — you
never paste an id or a secret here. Only fill this in to point the install at a
node you already run yourself.

The MCP bridge reads the live Proxy URL and token from:

```text
~/.evolver/settings.json
```

If that file is absent, it falls back to:

```text
http://127.0.0.1:19820
```

The plugin starts the Proxy at session start; `evolver lifecycle start` starts it by hand. The bridge never prints Proxy tokens.

## Connecting to the EvoMap network (optional)

Local memory works with zero config. The network layer (searching and reusing
Genes and Capsules) is opt-in. To connect:

1. Leave `A2A_NODE_ID` blank. Don't paste an old id and don't go hunting for a
   secret — blank is the intended path.
2. Start a WorkBuddy session. The plugin installs and starts Evolver for you;
   its first run registers a fresh node and writes a **claim link**.
3. Open that link while signed in to [evomap.ai](https://evomap.ai) to claim the
   node. Check status any time with `node scripts/evolver-status.mjs` or
   `/evolver-status`.

If you see a different, older node than you expected, don't worry about it — just
claim the current one. Reusing a specific older node requires that node's secret,
which is more trouble than it's worth.

## Commands

- `/evolver-status` shows the Proxy, the engine setup (status, version, error and next retry), and the latest reuse reports: deliveries with the Hub's `eligible` / `counted` / `weight`, and rejections with their reason.
- `/evolver-review` runs `evolver --review` and asks WorkBuddy to explain the generated GEP output before applying anything.
- `/evolver-search` searches Hub Recipes first, then falls back to Gene/Capsule search.

## Automatic Evolver setup

At every session start the hook checks the Proxy (`GET /proxy/status`, 1.5s). When it is not running, or the running one reports a version below **2.0.44** in `~/.evolver/settings.json`, the hook starts `scripts/background-worker.mjs` detached and returns at once. The worker:

1. Uses the newest Evolver it finds that meets 2.0.44: the plugin-managed copy in `${CODEBUDDY_PLUGIN_DATA}/engine`, else an `evolver` on `PATH`.
2. If neither is new enough, runs `npm install --prefix ${CODEBUDDY_PLUGIN_DATA}/engine @evomap/evolver@latest`, using the npm that ships next to the Node.js running the hook (falling back to `npm` on `PATH`). Nothing goes into the global npm prefix, and nothing needs `sudo` or administrator rights.
3. Starts the Proxy with `evolver lifecycle start` (or `lifecycle restart` when it replaced an older running Proxy) and waits up to 60s for `/proxy/status` to answer. It sets `EVOLVER_SELF_UPDATE=off` unless you set it yourself, so Evolver does not migrate itself to a standalone binary or register a launchd / systemd / scheduled-task service on your behalf.

Only one worker installs at a time (a lock directory in the plugin data folder, refreshed while npm runs and considered stale after 2 minutes). A failed install or start is retried after 10 minutes, then 20, 40 and so on up to once a day; while npm still has nothing new enough, the upgrade is retried every 6 hours and the older Proxy keeps running. The outcome is kept in `${CODEBUDDY_PLUGIN_DATA}/engine.json`, told to the model at the next session start (with the manual fix when it failed) and shown by `/evolver-status`.

| Platform | What the worker runs |
| --- | --- |
| macOS | `<node> <npm-cli.js> install --prefix ~/.workbuddy/plugins/data/<plugin>/engine …`, then `<node> …/@evomap/evolver/bin/evolver.js lifecycle start`. |
| Linux | Same as macOS; the Proxy runs as a detached user process, no systemd unit is installed. |
| Windows | Same, through `node.exe` directly (no `cmd` shim), with `windowsHide`; npm comes from the Node.js folder, else `npm.cmd` through the shell with quoted arguments. |

By hand: `npm install -g @evomap/evolver@latest`, then `evolver lifecycle start`.

## Reuse reports

Every strategy the plugin injects is reported once per turn as `{asset_id, outcome, task_id, reason, evidence}` to Proxy `POST /asset/reuse-result`. `reason` names the turn, the applied verdict and the check kind, never the prompt, a command or code.

| Report | `task_id` | `evidence` | Sent when |
| --- | --- | --- | --- |
| Turn end | `workbuddy:<session>:<turn>` | `tier` `L1` when a check ran, else `none`; `applied`; `check {kind, passed, fail_then_pass}`; `stage: immediate` | Stop hook |
| Correction / approval | `…:correction` | `tier: L3`, `applied`, `stage: correction` | the next prompt plainly says the turn did not work, or thanks it |
| Retention | `…:retention` | `tier: L2`, `applied`, `stage: retention` | the next session in the same project finds the edited files kept or reverted |
| `evolver_asset_reuse_result` | the model's own | `tier: L5`, `applied`, `stage: immediate` | the model calls the MCP tool |

- The Stop hook reads the turn from the session transcript (`transcript_path`), starting at the size it had when the prompt was submitted: shell calls (`Bash`, `PowerShell`) with their `Exit Code` and output, `Write` / `Edit` / `MultiEdit` / `NotebookEdit` arguments (200,000 characters a turn at most, never stored), paths, and the last assistant message (`last_assistant_message` when the transcript has none).
- A check is the turn's last test, build, lint or type-check command not run in the background. It failed when its call did not complete, its exit code was not 0, or its output reports a failure. `fail_then_pass` compares the commands with output pipes and redirects (`| tail -9`, `2>&1`) removed.
- `applied` is `used` when at least half the strategy's steps show up in the turn, `partial` when fewer do, `unused` when none do. When there is nothing to compare (only an answer, or no numbered steps) the report goes out as tier `none` with `applied: partial`, which the Hub weighs at 0 without the soft negative, and the reason says `applied: unknown`.
- Outcome follows the last check; without one, a turn that left an answer is `success`, one that left none `failed`.
- The PreToolUse hook hashes each file before the turn's first edit to it, so the next session can tell kept from reverted.
- Delivery goes through a queue that a detached worker drains, retried at every turn end and session start for 8 days. A Hub answer of `recorded`, `duplicate_report`, or `eligible: false` (`same_owner`, `daily_cap`) is final; `terminal: true`, `hub 400`, `hub 422` or a Proxy validation 400 is settled as rejected; `hub 404`, 5xx, 401/403/429, timeouts and an unreachable Proxy are retried.
- Evolver 2.0.44 or newer forwards `evidence` and returns `eligible` / `counted` / `weight`; an older Proxy drops the evidence and the reports still count as plain reuse reports.

State lives in `${CODEBUDDY_PLUGIN_DATA}` (fallback `~/.evolver/workbuddy-hooks/`): `session-<hash>.json` (turn counter, injected strategies, last turn's reuses), `edits-<hash>.jsonl`, `reports-queue.jsonl`, `reports-outbox.json`, `retention-pending.jsonl`, `engine.json`. Session files are removed after 8 days.

## Hooks

- `SessionStart` → `hooks/session-start.mjs` (5s timeout).
- `UserPromptSubmit` → `hooks/user-prompt-submit.mjs` (8s timeout, 5s Proxy recall; selection logic in `lib/strategy-recall.mjs`).
- `PreToolUse` on `Write|Edit|MultiEdit|NotebookEdit` → `hooks/pre-tool-use.mjs` (5s timeout).
- `Stop` → `hooks/stop.mjs` (10s timeout; subagent stops are skipped).

Plugin `hooks/hooks.json` hooks are not gated by `allowUntrustedFrontmatterHooks`; they run once the plugin is enabled.

## MCP Tools

- `evolver_status`
- `evolver_recipe_search`
- `evolver_recipe_express`
- `evolver_search_assets` (fallback)
- `evolver_fetch_asset`
- `evolver_asset_reuse_result`
- `evolver_publish_asset`
- `evolver_distill_conversation`
- `evolver_poll`

## Verify

From this plugin directory:

```bash
npm test   # from the repository root
node scripts/evolver-status.mjs
node mcp/evolver-proxy.mjs
echo '{"hook_event_name":"SessionStart","source":"startup"}' | node hooks/session-start.mjs
echo '{"session_id":"t","prompt":"Postgres connection pool exhausted, how to debug"}' | node hooks/user-prompt-submit.mjs
```

In normal WorkBuddy use, run `/evolver-status` or ask WorkBuddy to check Evolver Proxy status; when the MCP bridge is loaded it should call `evolver_status` first.

## License

GPL-3.0-or-later, matching the upstream Evolver engine. See [LICENSE](LICENSE).
