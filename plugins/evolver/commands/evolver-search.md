---
description: "Search EvoMap Recipes first through the Evolver Proxy; Gene/Capsule search is fallback"
argument-hint: "query or signal [more...]"
---

# Evolver Recipe Search

Call `evolver_status` first to confirm the local Proxy is running.

Treat `$ARGUMENTS` as a free-text Recipe query. If empty, derive the query from the current user task.

1. Call `evolver_recipe_search` with `q` set to that query. Omit `q` to list published Recipes.
2. If a Recipe hit applies, call `evolver_recipe_express` with its `recipeId`. Hub unfolds Gene then Capsule steps; do not parse recipe JSON locally.
3. Only if no Recipe matches, call `evolver_search_assets` with signal keywords, then summarize returned Genes or Capsules.

If the MCP tools are unavailable or the Proxy is unreachable, explain how to start the Proxy by running `evolver` once inside a git-initialized workspace. Do not query EvoMap Hub APIs directly.
