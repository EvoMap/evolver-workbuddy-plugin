---
description: "Run one Evolver self-evolution cycle on this repository (evolver run)."
argument-hint: "[--loop] [--dry-run] [--strategy=…]"
---

!`CODEBUDDY_PLUGIN_DATA="${CODEBUDDY_PLUGIN_DATA}" exec node "${CODEBUDDY_PLUGIN_ROOT}/scripts/evolver-cli.mjs" run <<'EVOLVER_ARGUMENTS'
$ARGUMENTS
EVOLVER_ARGUMENTS`

Show the output above to the user as it is. Do not call any other tool or command for it.
