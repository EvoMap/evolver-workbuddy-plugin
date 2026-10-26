---
description: "Sync assets between the local store and the EvoMap Hub (evolver sync)."
argument-hint: "[--scope=…] [--type=…] [--dry-run]"
---

!`CODEBUDDY_PLUGIN_DATA="${CODEBUDDY_PLUGIN_DATA}" exec node "${CODEBUDDY_PLUGIN_ROOT}/scripts/evolver-cli.mjs" sync <<'EVOLVER_ARGUMENTS'
$ARGUMENTS
EVOLVER_ARGUMENTS`

Show the output above to the user as it is. Do not call any other tool or command for it.
