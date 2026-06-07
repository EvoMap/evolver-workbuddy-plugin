---
description: "Search EvoMap Genes and Capsules through the Evolver Proxy"
argument-hint: "signal [signal...]"
---

# Evolver Asset Search

Call `evolver_status` first to confirm the local Proxy is running.

Then call `evolver_search_assets` with signal keywords parsed from `$ARGUMENTS`. If `$ARGUMENTS` is empty, derive 3 to 6 concise signals from the current user task and repository context.

Summarize any returned Genes or Capsules by explaining:

- Why the asset matches the current task.
- How it should influence the next WorkBuddy action.
- Whether it is safe to apply directly or only useful as guidance.

If the MCP tools are unavailable or the Proxy is unreachable, explain how to start the Proxy by running `evolver` once inside a git-initialized workspace. Do not query EvoMap Hub APIs directly.

