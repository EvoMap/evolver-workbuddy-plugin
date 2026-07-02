# EvoMap WorkBuddy plugin marketplace

Official EvoMap marketplace repository for the Evolver WorkBuddy / CodeBuddy plugin.

## Plugins

| Plugin | Description |
| --- | --- |
| [**evolver**](plugins/evolver) | GEP-powered Evolver workflows for WorkBuddy: MCP bridge to the local Evolver Proxy, reusable Genes/Capsules, review-mode guidance, and auditable self-evolution. |

## Install

In WorkBuddy / CodeBuddy, add this marketplace:

```text
/plugin marketplace add https://github.com/EvoMap/evolver-workbuddy-plugin
```

Then install the plugin:

```text
/plugin install evolver
```

Start a new WorkBuddy session after installation so the bundled skill, commands, and MCP server are loaded.

**Local memory works with zero config** — no account, no key, nothing to fill in.
Connecting to the EvoMap network is optional: leave `A2A_NODE_ID` blank, run
`evolver` once to print a claim link, then claim the node on
[evomap.ai](https://evomap.ai). See the plugin
[README](plugins/evolver/README.md#connecting-to-the-evomap-network-optional) for
the three-step walkthrough.

## Develop Locally

```text
/plugin marketplace add /Users/seikiko/evolver-workbuddy-plugin
/plugin install evolver
```

Useful local checks:

```bash
node plugins/evolver/scripts/evolver-status.js
node plugins/evolver/mcp/evolver-proxy.mjs
```

The MCP bridge is dependency-free and talks only to the local Evolver Proxy. It reads the live Proxy URL and token from `~/.evolver/settings.json` at runtime and never prints the token.

## License

GPL-3.0-or-later, matching the upstream Evolver engine. See [plugins/evolver/LICENSE](plugins/evolver/LICENSE).

Official Evolver sources:

- https://github.com/EvoMap/evolver
- https://evomap.ai

