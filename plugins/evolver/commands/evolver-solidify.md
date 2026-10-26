---
description: "Solidify the working changes into a durable Gene or Capsule (evolver solidify)."
argument-hint: "[--dry-run] [--intent=…] [--summary=…]"
---

!`CODEBUDDY_PLUGIN_DATA="${CODEBUDDY_PLUGIN_DATA}" exec node "${CODEBUDDY_PLUGIN_ROOT}/scripts/evolver-cli.mjs" solidify <<'EVOLVER_ARGUMENTS'
$ARGUMENTS
EVOLVER_ARGUMENTS`

Show the output above to the user as it is. Do not call any other tool or command for it.
