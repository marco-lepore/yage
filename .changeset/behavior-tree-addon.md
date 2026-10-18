---
"@yagejs-addons/behavior-tree": minor
---

Add typed behavior trees with per-entity execution and Inspector diagnostics.

- Compose actions, conditions, remembered or reactive sequences and selectors, guards, waits, timeouts, inversion, and reusable subtrees.
- Release running actions before replacement work starts, with explicit cancellation reasons and callback errors attributed through YAGE's ErrorBoundary.
- Drive trees through a component using scaled frame or fixed time, or use the headless runner directly. Inspect active nodes, bounded transition history, and callback failures.
