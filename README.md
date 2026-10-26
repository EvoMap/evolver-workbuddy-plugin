# EvoMap WorkBuddy plugin marketplace

Official EvoMap marketplace repository for the Evolver WorkBuddy / CodeBuddy plugin.

## Plugins

| Plugin | Description |
| --- | --- |
| [**evolver**](plugins/evolver) | Evolver for WorkBuddy, all from hooks: proven strategies recalled behind the prompt, automatic reuse reports, and session-end distillation into reusable Genes, with nothing else of Evolver in the model's context. |

## Install

In WorkBuddy / CodeBuddy, add this marketplace:

```text
/plugin marketplace add https://github.com/EvoMap/evolver-workbuddy-plugin
```

Then install the plugin:

```text
/plugin install evolver
```

Start a new WorkBuddy session after installation so the hooks and `/evolver-*` commands are loaded. The plugin adds no MCP server, skill or tool to the model's context.

**Local memory works with zero config** — no account, no key, nothing to fill in.
The plugin installs and starts Evolver by itself at session start. Connecting to
the EvoMap network is optional: leave `A2A_NODE_ID` blank and claim the node on
[evomap.ai](https://evomap.ai) with the link Evolver prints. See the plugin
[README](plugins/evolver/README.md#connecting-to-the-evomap-network-optional) for
the three-step walkthrough.

## Develop Locally

```text
/plugin marketplace add /Users/seikiko/evolver-workbuddy-plugin
/plugin install evolver
```

Useful local checks:

```bash
npm test
node plugins/evolver/scripts/evolver-status.mjs
```

The hooks and scripts are dependency-free and talk only to the local Evolver Proxy. They read the live Proxy URL and token from `~/.evolver/settings.json` at runtime and never print the token.

## License

GPL-3.0-or-later, matching the upstream Evolver engine. See [plugins/evolver/LICENSE](plugins/evolver/LICENSE).

Official Evolver sources:

- https://github.com/EvoMap/evolver
- https://evomap.ai

