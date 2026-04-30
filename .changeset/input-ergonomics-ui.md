---
"@yagejs/ui": minor
---

Input ergonomics: frame-deferred action edges, pointer/wheel consume primitives, listener parity, and UI auto-consume via the renderer's hit-test fallback.

- Every UI primitive (`UIButton`, `UICheckbox`, `UIPanel`, `UIImage`, `UINineSlice`, `UIProgressBar`, `UIText`) now marks its underlying Pixi container via `markPointerConsumeContainer` from `@yagejs/core`. Combined with the renderer's `hitTestUI` and `@yagejs/input`'s drain-time fallback, taps on any UI element — including blank panel backgrounds, decorative text, and layout containers with no handlers — automatically suppress gameplay action edges (`MouseLeft` / `Middle` / `Right`).
- New per-component escape hatch: `consumeInput?: boolean` on every UI prop interface (default `true`). Set to `false` for see-through overlays (cosmetic full-screen filters, decorative HUD borders) that should let pointer events propagate to gameplay. Lives on the underlying primitive props so it propagates through `@yagejs/ui-react` mirrors with no extra wiring.
