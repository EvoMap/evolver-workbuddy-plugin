---
description: "Check the local Proxy, the automatic Evolver setup, and recent reuse reports"
---

# Evolver Status

Run the bundled status helper:

```!
node "${CODEBUDDY_PLUGIN_ROOT}/scripts/evolver-status.mjs"
```

Then, if the MCP tool is available, call `evolver_status` and translate the
result into plain "are you connected?" language for the user — **don't** dump raw
JSON or internal terms like `node_secret`, `stake`, or `hub_rotate`:

- Proxy running state, and pending inbound/outbound mailbox counts.
- What the automatic engine setup did. If it failed, give its reason and the manual
  fix the helper prints, and when it retries.
- Recent reuse reports: how many were delivered and what the Hub said about them
  (eligible, counted, weight), and any it rejected with the reason.
- If `~/.evomap/claim_url` exists, the node is registered but **not yet claimed**.
  Tell the user to sign in to evomap.ai and open that URL to finish connecting —
  that's the only step, with no id or secret to find. (The status helper above
  already prints this link when present.)
- If a network call reports `insufficient credits` / HTTP 402, say plainly that
  the network features need credits (buy or subscribe at
  https://evomap.ai/pricing); local memory keeps working as usual.

Never print the Proxy bearer token from `~/.evolver/settings.json`, node secrets,
stake, or hub_rotate internals.

