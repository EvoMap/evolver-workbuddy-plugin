# Evolver — WorkBuddy / CodeBuddy plugin

Self-evolution workflows for WorkBuddy, powered by [Evolver](https://github.com/EvoMap/evolver) (`@evomap/evolver`) and [EvoMap](https://evomap.ai).

This plugin packages Evolver as a WorkBuddy-ready workflow: a model-invoked skill, SessionStart / UserPromptSubmit hooks, slash commands, a local status helper, and an MCP bridge to the Evolver Proxy mailbox for Genes and Capsules.

## What It Does

| Layer | Mechanism | Behavior |
| --- | --- | --- |
| Session context | SessionStart hook | On startup, resume, clear, and compact, probes the local Proxy and injects a short `additionalContext` note: whether `evolver_*` tools are live, Recipe-first guidance, and a pending-claim hint. Fails open with `{}`. |
| Prompt recall | UserPromptSubmit hook | Searches local-Proxy Genes/Capsules with the user's prompt and injects at most 2 hits with `similarity >= 0.9`, each only once per session. Skips slash commands, acknowledgements, and prompts under 12 characters. Each hit carries the asset's approach summary and use/avoid conditions inline, so the agent can apply it without a fetch. 5s search budget; fails open with `{}`. |
| Passive recall | Skill guidance | Guides WorkBuddy to check local memory, reusable Genes, and relevant Capsules before substantive changes. |
| Network bridge | MCP server `evolver-proxy` | Exposes Recipe-first `evolver_recipe_search` / `evolver_recipe_express`, then fallback `evolver_search_assets`, plus `evolver_status`, `evolver_fetch_asset`, `evolver_publish_asset`, `evolver_distill_conversation`, and `evolver_poll` through the local EvoMap Proxy mailbox. |
| Quick entry | Slash commands | Adds `/evolver-status`, `/evolver-review`, and `/evolver-search` for common workflows. |
| Active control | CLI workflow | Guides WorkBuddy through `evolver`, `evolver --review`, `evolver --loop`, and strategy presets. |
| Safety boundary | Git + review | Evolver emits protocol-bound GEP prompts and audit events; WorkBuddy should not auto-apply generated output unless the user asks. |

The plugin is self-contained on the WorkBuddy side. Active evolution still uses the official Evolver CLI or the local Proxy started by Evolver.

## Prerequisites

- Node.js 18 or newer.
- Git.
- A git-initialized workspace for project runs.
- Optional: global Evolver CLI.

```bash
npm install -g @evomap/evolver
```

If the CLI is not installed globally, WorkBuddy can still explain setup. Use networked install commands only when the user approves.

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

Start the Proxy by running `evolver` once inside a git repo. The bridge never prints Proxy tokens.

## Connecting to the EvoMap network (optional)

Local memory works with zero config. The network layer (searching and reusing
Genes and Capsules) is opt-in. To connect:

1. Leave `A2A_NODE_ID` blank. Don't paste an old id and don't go hunting for a
   secret — blank is the intended path.
2. Install the engine and run it once inside a git repo:

   ```bash
   npm i -g @evomap/evolver
   evolver
   ```

   The first run registers a fresh node for you and prints a **claim link**.
3. Open that link while signed in to [evomap.ai](https://evomap.ai) to claim the
   node. Check status any time with `node scripts/evolver-status.js` or
   `/evolver-status`.

If you see a different, older node than you expected, don't worry about it — just
claim the current one. Reusing a specific older node requires that node's secret,
which is more trouble than it's worth.

## Commands

- `/evolver-status` checks Node, Git, Evolver CLI, git workspace status, and Proxy settings.
- `/evolver-review` runs `evolver --review` and asks WorkBuddy to explain the generated GEP output before applying anything.
- `/evolver-search` searches Hub Recipes first, then falls back to Gene/Capsule search.

## Hooks

- `SessionStart` → `hooks/session-start.mjs` (5s timeout).
- `UserPromptSubmit` → `hooks/user-prompt-submit.mjs` (8s timeout, 5s Proxy search). Per-session dedupe state lives in `${CODEBUDDY_PLUGIN_DATA}/recall-state.json` (fallback `~/.evolver/workbuddy-hooks/`), pruned after 24h. Plugin `hooks/hooks.json` hooks are not gated by `allowUntrustedFrontmatterHooks`; they run once the plugin is enabled.

## MCP Tools

- `evolver_status`
- `evolver_recipe_search`
- `evolver_recipe_express`
- `evolver_search_assets` (fallback)
- `evolver_fetch_asset`
- `evolver_publish_asset`
- `evolver_distill_conversation`
- `evolver_poll`

## Verify

From this plugin directory:

```bash
node scripts/evolver-status.js
node mcp/evolver-proxy.mjs
echo '{"hook_event_name":"SessionStart","source":"startup"}' | node hooks/session-start.mjs
echo '{"session_id":"t","prompt":"Postgres connection pool exhausted, how to debug"}' | node hooks/user-prompt-submit.mjs
```

In normal WorkBuddy use, run `/evolver-status` or ask WorkBuddy to check Evolver Proxy status; when the MCP bridge is loaded it should call `evolver_status` first.

## License

GPL-3.0-or-later, matching the upstream Evolver engine. See [LICENSE](LICENSE).
