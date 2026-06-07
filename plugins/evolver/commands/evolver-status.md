---
description: "Check Evolver CLI, git workspace, and local Proxy status"
---

# Evolver Status

Run the bundled status helper:

```!
node "${CODEBUDDY_PLUGIN_ROOT}/scripts/evolver-status.js"
```

Then, if the MCP tool is available, call `evolver_status` and report:

- Proxy running state.
- Node ID.
- Pending inbound/outbound mailbox counts.
- Last Hub sync time.

Never print the Proxy bearer token from `~/.evolver/settings.json`.

