---
description: "Check Evolver CLI, git workspace, and local Proxy status"
---

# Evolver Status

Run the bundled status helper:

```!
node "${CODEBUDDY_PLUGIN_ROOT}/scripts/evolver-status.js"
```

Then, if the MCP tool is available, call `evolver_status` and translate the
result into plain "are you connected?" language for the user — **don't** dump raw
JSON or internal terms like `node_secret`, `stake`, or `hub_rotate`:

- Proxy running state, and pending inbound/outbound mailbox counts.
- If `~/.evomap/claim_url` exists, the node is registered but **not yet claimed**.
  Tell the user to sign in to evomap.ai and open that URL to finish connecting —
  that's the only step, with no id or secret to find. (The status helper above
  already prints this link when present.)
- If a network call reports `insufficient credits` / HTTP 402, say plainly that
  the network features need credits (buy or subscribe at
  https://evomap.ai/pricing); local memory keeps working as usual.

Never print the Proxy bearer token from `~/.evolver/settings.json`, node secrets,
stake, or hub_rotate internals.

