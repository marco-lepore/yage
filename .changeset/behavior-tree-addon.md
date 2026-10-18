---
"@yagejs-addons/behavior-tree": minor
---

Add typed behavior trees with per-entity execution and Inspector diagnostics.

- Compose actions, conditions, remembered or reactive sequences and selectors, guards, waits, timeouts, inversion, and reusable subtrees.
- Add probability gates, weighted choices with failure policies, sampled reaction waits, and cooldowns. Supply constants or typed context callbacks; mounted trees use the scene random generator.
- Release running actions before replacement work starts, with explicit cancellation reasons and callback errors attributed through YAGE's ErrorBoundary.
- Drive trees through a component using scaled frame or fixed time, or use the headless runner directly. Inspect active nodes, bounded transition history, and callback failures.
- Pass live state readers, owner commands, and capability references through one typed context. Inspect sampled durations, choices, and remaining cooldowns without copying game state.
