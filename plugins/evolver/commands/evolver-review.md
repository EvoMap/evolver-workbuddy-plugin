---
description: "Run Evolver review mode and explain the GEP output"
argument-hint: "[optional focus]"
---

# Evolver Review

Check that the current directory is a git workspace:

```!
git rev-parse --is-inside-work-tree
```

Run Evolver review mode:

```!
evolver --review
```

Use `$ARGUMENTS` only as the user's optional focus for the explanation. Summarize:

- Selected Gene or Capsule, if any.
- Input signals and memory evidence.
- Proposed next action.
- Validation or review gate.
- EvolutionEvent or audit trail implication.

Do not apply Evolver output as source changes unless the user explicitly asks for implementation.

