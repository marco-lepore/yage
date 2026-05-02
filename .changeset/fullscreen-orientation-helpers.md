---
"@yagejs/renderer": minor
"@yagejs/core": minor
---

Fullscreen helper on `RendererPlugin`, plus viewport-lifecycle bus events.

- `RendererPlugin.requestFullscreen()` / `exitFullscreen()` / `isFullscreen` getter — wraps the browser fullscreen API with a `webkitRequestFullscreen` fallback for iOS Safari. Targets the configured `container` (so DOM overlays placed alongside the canvas remain inside the fullscreened area), falling back to the canvas when no container was provided.
- `RendererPlugin.orientation` getter — current `OrientationType`, or `null` when neither `screen.orientation` nor the legacy `window.orientation` angle is available.
- New typed events on `EngineEvents`:
  - `screen:fullscreen` with payload `{ active: boolean }` — fired by `RendererPlugin` on `fullscreenchange` / `webkitfullscreenchange` (entering, exiting, Esc, browser UI).
  - `screen:orientation` with payload `{ type: OrientationType }` — fired by `RendererPlugin` on `screen.orientation.change`, falling back to `window.orientationchange` on browsers without the modern API.
- Listeners install during `RendererPlugin.install()` (gated behind `typeof document/window !== "undefined"` so node-environment tests are unaffected) and tear down in `onDestroy()`.
