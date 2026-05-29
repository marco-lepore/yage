---
"@yagejs/ui": minor
"@yagejs/ui-react": patch
---

Bring the floating/tooltip system to the non-React `@yagejs/ui` layer with a new headless `attachTooltip`.

The `FloatingOverlay`, its `FloatingOverlayKey`, the pure `computePosition` positioning engine, `FloatConfig` / `FloatingHandle`, and the `layoutFloat` helper now live in `@yagejs/ui` (previously React-only). The overlay is framework-agnostic: `FloatingHandle` carries a `setLayout(fn)` callback so the overlay no longer reaches into the React reconciler to measure its content.

- **`@yagejs/ui` — `attachTooltip(trigger, scene, { content, placement, offset, maxWidth })`**. Imperative, headless tooltip for any UI primitive (`UIPanel._node`, `UIButton`, `UIImage`, …). Wires the trigger's `onHover`, parents a content node into the scene overlay, and returns a `dispose()` that detaches the hover handler and releases the slot. Works in a pure imperative scene with **no `<UIRoot>` / React** — diegetic UI like `ScreenFollow` namecards can now have tooltips.
- **`@yagejs/ui` — `FloatingOverlaySystem`** (`Phase.LateUpdate`, priority `201`, registered by `UIPlugin`). Walks `SceneManager.activeScenes` and re-anchors each scene's overlay every frame after `UILayoutSystem`, with or without a `UIRoot`.
- **`@yagejs/ui` — `UIPlugin`** now provisions the scene-scoped `FloatingOverlay` (via scene hooks) so floating UI exists independently of React. `computePosition`, `parsePlacement`, `Placement` / `Side` / `Align` / `Rect` / `Dimensions`, `FloatConfig`, `FloatingHandle`, `FloatingOverlay`, `FloatingOverlayKey`, and `layoutFloat` are exported as escape hatches for custom popovers / menus.

`@yagejs/ui-react` re-exports the moved symbols from `@yagejs/ui` for back-compat (`FloatingOverlayCtx` stays React-only), `useFloating` supplies the reconciler-specific `setLayout`, and `UIReactPlugin` no longer double-registers the overlay (now owned by `UIPlugin`). The React `<Tooltip>` / `useFloating` API is unchanged.
