---
"@yagejs/core": minor
---

Input ergonomics: frame-deferred action edges, pointer/wheel consume primitives, listener parity, and UI auto-consume via the renderer's hit-test fallback.

- New cross-package consume registry: `markPointerConsumeContainer(c)`, `unmarkPointerConsumeContainer(c)`, `isPointerConsumeContainer(c)` over a module-level `WeakSet`. Used by `@yagejs/ui`, `@yagejs/ui-react`, and `@yagejs/renderer` (sprite opt-in) to flag display containers as UI-input surfaces; `@yagejs/input`'s drain step queries the renderer's `hitTestUI(x, y)` to auto-claim pointer presses landing on any marked container.
- `RendererAdapter` interface gains an optional `hitTestUI?(x, y): boolean` for renderer implementations to expose a virtual-space hit test. The canonical `@yagejs/renderer` implements it; foreign renderers can omit and the input-side fallback is a no-op.
