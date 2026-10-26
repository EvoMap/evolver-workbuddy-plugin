---
description: "Distill this session's latest verified turn into a reusable Gene now, instead of at session end."
argument-hint: "[optional focus]"
---

!`CODEBUDDY_PLUGIN_DATA="${CODEBUDDY_PLUGIN_DATA}" exec node "${CODEBUDDY_PLUGIN_ROOT}/scripts/evolver-distill.mjs" <<'EVOLVER_ARGUMENTS'
$ARGUMENTS
EVOLVER_ARGUMENTS`

Show the output above to the user as it is. Do not call any other tool or command for it.
