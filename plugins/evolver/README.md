# Evolver — WorkBuddy / CodeBuddy plugin

Self-evolution workflows for WorkBuddy, powered by [Evolver](https://github.com/EvoMap/evolver) (`@evomap/evolver`) and [EvoMap](https://evomap.ai).

This plugin packages Evolver as WorkBuddy hooks, slash commands and a few small scripts. Nothing of Evolver but the recalled steps enters the model's context: there is no MCP server, no skill and no `evolver_*` tool. Reports go out at every turn end, the session's verified work is distilled when the session ends, and the `/evolver-*` commands (status, search, distill, evolve, sync, review, run, solidify) run plugin scripts and show their output; only `/evolver-evolve` is a prompt for the agent.

## What It Does

| Layer | Mechanism | Behavior |
| --- | --- | --- |
| Engine setup | SessionStart hook + background worker | Makes sure this machine has a running Evolver Proxy of at least the required version: installs or upgrades `@evomap/evolver` into the plugin's data folder (never `npm -g`, never `sudo`) and starts it with `evolver lifecycle start`, all in a detached process so the hook stays within its timeout. See [Automatic Evolver setup](#automatic-evolver-setup). |
| Engine notice | SessionStart hook | Says nothing, except once for each outcome of the engine setup (installed, upgraded, started, or why it failed, with the manual fix). Fails open with `{}`. |
| Prompt recall | UserPromptSubmit hook | Recalls by text through Proxy `/asset/fetch` (no ids, no `limit`: the Proxy default of 2 candidates) and injects one asset's complete strategy as an `[Evolution Memory]` block. Picks the best-scored asset with 4+ steps and at most 4000 strategy characters, each only once per session. Skips slash commands, acknowledgements, and prompts under 8 characters. 5s recall budget; fails open with `{}`. |
| Reuse reports | FinalStop, SessionEnd, UserPromptSubmit, PreToolUse and SessionStart hooks | Reports every injected strategy to the Hub through Proxy `POST /asset/reuse-result`, with evidence read off the turn: the last test/build/lint/type-check, whether the strategy's steps show up in the turn's commands, paths, written code and answer, the next prompt's correction or approval, and whether the next session still has the edited files. See [Reuse reports](#reuse-reports). |
| Distillation | FinalStop, UserPromptSubmit, SessionEnd and SessionStart hooks + background worker | A verified turn leaves a candidate; at session end a detached worker turns it into a Gene with one headless model call. See [Session-end distillation](#session-end-distillation). |
| Quick entry | Slash commands | `/evolver-status`, `/evolver-search`, `/evolver-distill`, `/evolver-evolve`, `/evolver-sync`, `/evolver-review`, `/evolver-run`, `/evolver-solidify`. |
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

The hooks and scripts read the live Proxy URL and token from:

```text
~/.evolver/settings.json
```

If that file is absent, it falls back to:

```text
http://127.0.0.1:19820
```

The plugin starts the Proxy at session start; `evolver lifecycle start` starts it by hand. Nothing prints Proxy tokens.

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

WorkBuddy commands are prompts the model follows, so the plugin cannot answer one itself. The closest equivalent: each command's body holds one inline `` !`…` `` command, which the host runs while it renders the command and replaces by its output, and tells the model to show that output as it is, with no `evolver_*` tool involved. The arguments reach the script on stdin through a quoted heredoc, so no shell expands them, and the shell `exec`s the script, so a quoted argument line that ends the heredoc early runs nothing after it. The host's shell carries no plugin's data folder, so each command sets `CODEBUDDY_PLUGIN_DATA` from the `${CODEBUDDY_PLUGIN_DATA}` the host fills in when it loads the command; the scripts then read the state the hooks write. The host splits the arguments itself and drops their quotes before `$ARGUMENTS` is filled in, so `--summary="two words"` arrives as two words; a backtick in the arguments ends the inline command early (the rest is not run). On Windows the heredoc needs the host to run commands through bash (Git Bash), as it does when bash is installed; PowerShell has none.

- `/evolver-status` shows the Proxy, the engine setup (status, version, error and next retry), and the latest reuse reports: deliveries with the Hub's `eligible` / `counted` / `weight`, and rejections with their reason.
- `/evolver-search <task description or error text>` searches the EvoMap network through Proxy `POST /asset/search` (5 results).
- `/evolver-distill [focus]` distills this session's latest verified turn now, instead of at session end (`scripts/evolver-distill.mjs`, keyed by `CODEBUDDY_SESSION_ID`); when the headless model cannot, the agent writes the Gene itself (see [Session-end distillation](#session-end-distillation)).
- `/evolver-evolve [focus]` is the one prompt-only command: an evolution checkpoint the agent runs (recall, reflect). The host appends the focus as `ARGUMENTS:` instead of dsh's `Focus:` line.
- `/evolver-sync`, `/evolver-review`, `/evolver-run`, `/evolver-solidify` run `evolver sync|review|run|solidify` with the given arguments: the plugin-managed Evolver when installed, else `evolver` on `PATH`, else `npx -y @evomap/evolver@^2.0.44`; 10 minutes at most, after which the process group is stopped.

A turn that runs an `/evolver-*` command, typed or as the host renders it (`<command-name>/evolver-…</command-name>`), is never recalled for, never read as a correction, and never a distillation candidate.

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
| Turn end | `workbuddy:<session>:<turn>` | `tier` `L1` when a check ran, else `none`; `applied`; `check {kind, passed, fail_then_pass}`; `aborted: false`; `stage: immediate` | FinalStop hook: `completed` as completed, `interrupted` / `cancelled` as aborted (`aborted: true`), `failed` as an error |
| Correction / approval | `…:correction` | `tier: L3`, `applied`, `stage: correction` | the next prompt plainly says the turn did not work, or thanks it |
| Retention | `…:retention` | `tier: L2`, `applied`, `stage: retention` | the next session in the same project finds the edited files kept or reverted |
| Aborted | `workbuddy:<session>:<turn>` | `tier: none`, `applied: partial`, `aborted: true`, `stage: immediate` | the session ends before the turn does (SessionEnd hook), or its host process was killed (at the next session start, once that process is gone) |

- The FinalStop hook reads the turn from the session transcript (`transcript_path`), starting at the size it had when the prompt was submitted: shell calls (`Bash`, `PowerShell`) with their `Exit Code` and output, `Write` / `Edit` / `MultiEdit` / `NotebookEdit` arguments (200,000 characters a turn at most, never stored), paths, and the last assistant message. FinalStop rather than Stop, because only FinalStop says how the turn ended (`final_stop_reason`), and it fires once a turn, after any Stop hook that asked the model to continue.
- A check is the turn's last test, build, lint or type-check command not run in the background. It failed when its call did not complete, its exit code was not 0, or its output reports a failure. `fail_then_pass` compares the commands with output pipes and redirects (`| tail -9`, `2>&1`) removed.
- `applied` is `used` when at least half the strategy's steps show up in the turn, `partial` when fewer do, `unused` when none do. When there is nothing to compare (only an answer, or no numbered steps) the report goes out as tier `none` with `applied: partial`, which the Hub weighs at 0 without the soft negative, and the reason says `applied: unknown`.
- Outcome follows the last check; without one, a completed turn that left an answer is `success`, one that left none `failed`, and an errored or aborted turn `failed`.
- The PreToolUse hook hashes each file before the turn's first edit to it, so the next session can tell kept from reverted.
- Delivery goes through a queue that a detached worker drains, retried at every turn end and session start for 8 days. A Hub answer of `recorded`, `duplicate_report`, or `eligible: false` (`same_owner`, `daily_cap`) is final; `terminal: true`, `hub 400`, `hub 422` or a Proxy validation 400 is settled as rejected; `hub 404`, 5xx, 401/403/429, timeouts and an unreachable Proxy are retried.
- Evolver 2.0.44 or newer forwards `evidence` and returns `eligible` / `counted` / `weight`; an older Proxy drops the evidence and the reports still count as plain reuse reports.

State lives in `${CODEBUDDY_PLUGIN_DATA}` (fallback `~/.evolver/workbuddy-hooks/`): `session-<hash>.json` (turn counter, the turn's prompt without secrets, injected strategies, last turn's reuses), `edits-<hash>.jsonl`, `reports-queue.jsonl`, `reports-outbox.json`, `retention-pending.jsonl`, `engine.json`, `workbuddy-distill-pending.json`. A session start moves a `workbuddy-distill-pending.json` an earlier build left in `~/.evolver/state/` in here (a candidate already here wins). Session files are removed after 8 days. Every read-modify-write of a session file or the candidate file runs under an exclusive lock (`<file>.lock`, holding the owner's pid and a token): a dead owner's lock is taken over, and one that cannot be had within 2 seconds is given up on and the write runs unguarded.

## Session-end distillation

A turn that ended completed, used tools, passed its last check and reused no injected strategy leaves a
candidate in `${CODEBUDDY_PLUGIN_DATA}/workbuddy-distill-pending.json` (apart from other hosts' candidates, which
run on another model; not in `~/.evolver`, which WorkBuddy's sandbox keeps `/evolver-*` commands from writing);
a later verified turn replaces it, and a next prompt that reads as a correction drops it. When
the session ends (SessionEnd hook), the candidate is marked closed and a detached worker writes a Gene from a
digest of that turn (task, commands, touched paths, checks, final answer — never the whole history) with one
headless call to the session's own model, then sends it to the Proxy's `POST /conversation/distill` with
`persist: true`, `publish: false` and its own token cost as `distill_usage`. Keys and tokens are stripped from
the candidate first, paths and a manual focus included.

Hooks have no model API, so the worker runs the CodeBuddy CLI headless, the prompt on stdin:
`codebuddy -p --tools "" --no-session-persistence --output-format json --max-turns 1 --model <the turn's model>`,
120 seconds at most. It uses the CLI bundled with WorkBuddy
(`~/Applications` or `/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy` on macOS,
`%LOCALAPPDATA%\Programs\WorkBuddy\resources\app.asar.unpacked\cli\bin\codebuddy` on Windows), else a
`codebuddy` on `PATH`. No CLI or no model in the transcript means `no_model`; a CLI that is not signed in or a
timeout means `model_failed`; each of those, an unparsed answer or a Proxy error is a failed try. The headless run loads this plugin as well, so
it is started with `EVOLVER_HEADLESS=1`, which every hook of this plugin answers with `{}` and nothing else.

A candidate stays on disk until it is distilled (three failed tries give it up). One whose session is over —
ended, or killed with its CodeBuddy process — is claimed by the next worker that starts (at every session start
and session end), one process at a time, while an idle session keeps its own. A correction that arrives while
the worker distills stops it: the worker watches the candidate file and never sends a candidate that is gone.
`/evolver-distill` does the same at once.

Inside the WorkBuddy app the headless CLI is usually not signed in: the app keeps its sign-in encrypted and gives
the key only to its own CLI, which removes it from the environment that hooks and commands inherit. So when
`/evolver-distill` gets no Gene from the headless model (`no_model`, `model_failed` or an unparsed answer), it
costs the candidate no try and prints `EVOLVER: WRITE THE GENE YOURSELF`, the same request the headless model
gets, and a command: the agent writes the Gene with the session's own model and runs
`node scripts/evolver-distill.mjs --post` with the JSON on stdin through its shell tool, which sends it for the
same candidate and removes it. This is the one place the turn's record enters the conversation, and only when
the user asked for it. Session-end distillation has no agent to fall back on and keeps counting failed tries.

The owner of a candidate or an injection is the CodeBuddy process that runs the hooks: the hook's parent, or the
parent of the `$SHELL -c` the host starts each hook through when that shell stays in between. Limits of that rule:

- One long-lived CodeBuddy process serves many sessions, so a session whose tab was killed while that process
  keeps running counts as killed only once the process exits; until then its injections and candidate wait.
- On Windows, where there is no cheap probe, entries carry no owner, so a killed session's leftovers wait for a
  session end that closes them.
- On Windows the CLI keeps its child processes in a kill-on-close job, so a SessionEnd worker can die with the
  CLI; its candidate stays closed on disk and the next session start distills it.

## Hooks

- `SessionStart` → `hooks/session-start.mjs` (5s timeout).
- `UserPromptSubmit` → `hooks/user-prompt-submit.mjs` (8s timeout, 5s Proxy recall; selection logic in `lib/strategy-recall.mjs`).
- `PreToolUse` on `Write|Edit|MultiEdit|NotebookEdit` → `hooks/pre-tool-use.mjs` (5s timeout).
- `FinalStop` → `hooks/final-stop.mjs` (10s timeout; subagent turns are skipped): reuse reports and the distillation candidate, by `final_stop_reason`.
- `SessionEnd` → `hooks/session-end.mjs` (5s timeout): aborted reports, closes the candidate, starts the distillation worker.

Plugin `hooks/hooks.json` hooks are not gated by `allowUntrustedFrontmatterHooks`; they run once the plugin is enabled.

## Verify

From this plugin directory:

```bash
npm test   # from the repository root
node scripts/evolver-status.mjs
node scripts/evolver-search.mjs "Postgres connection pool exhausted"
echo '{"hook_event_name":"SessionStart","source":"startup"}' | node hooks/session-start.mjs
echo '{"session_id":"t","prompt":"Postgres connection pool exhausted, how to debug"}' | node hooks/user-prompt-submit.mjs
```

In normal WorkBuddy use, run `/evolver-status`.

## License

GPL-3.0-or-later, matching the upstream Evolver engine. See [LICENSE](LICENSE).
