---
"@yagejs/ui-react": minor
---

Input ergonomics: frame-deferred action edges, pointer/wheel consume primitives, listener parity, and UI auto-consume via the renderer's hit-test fallback.

- `UIRoot` marks its host container as a consume surface so pointer events landing inside the React tree are automatically claimed by `@yagejs/input` (no per-component wiring required). New `consumeInput?: boolean` option on `UIRootOptions` (default `true`) — set `false` for transparent overlays that should let clicks pass through to gameplay.
- React UI mirrors (`Panel`, `Button`, `Checkbox`, `Image`, `NineSlice`, `ProgressBar`, `UIText`, plus the `Pixi*` wrappers) automatically forward the new `consumeInput` prop to their underlying `@yagejs/ui` primitives — no public API change in `components.tsx`.
