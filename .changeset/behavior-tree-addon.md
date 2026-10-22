---
"@yagejs-addons/behavior-tree": minor
---

Add typed behavior trees with per-entity execution and Inspector diagnostics.

- Compose actions, instant `call` actions, conditions, remembered or reactive sequences and selectors, parallel branches, guards, waits, timeouts, repeats, retries, inversion, forced results, and reusable subtrees.
- Add probability gates, weighted choices with failure policies, sampled reaction waits, and cooldowns. Supply constants or typed context callbacks; mounted trees use the scene random generator.
- Release running actions before replacement work starts, with explicit cancellation reasons and callback errors attributed through YAGE's ErrorBoundary. After a callback throws, every `tick()` throws until the tree is cancelled.
- Mount with `new BehaviorTreeAgent(definition, context)` on scaled frame or fixed time, or tick the headless `BehaviorTree` runner directly. Inspect active nodes, bounded transition history, sampled values, and callback failures.
- Save and restore cooldowns as plain JSON with `snapshot()` and `restore()`.
- Pass live state readers, owner commands, and capability references through one typed context, without copying game state.
