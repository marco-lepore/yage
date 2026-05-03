---
"@yagejs/renderer": minor
"@yagejs/core": minor
---

Fullscreen helper, viewport-lifecycle bus events, and a letterbox clipping fix.

**Fullscreen helper on `RendererPlugin`** (additive)

- `RendererPlugin.requestFullscreen()` / `exitFullscreen()` / `isFullscreen` getter — wraps the browser fullscreen API with a `webkitRequestFullscreen` fallback for iOS Safari. Targets the configured `container` (so DOM overlays placed alongside the canvas remain inside the fullscreened area), falling back to the canvas when no container was provided.
- `RendererPlugin.orientation` getter — current `OrientationType`, or `null` when neither `screen.orientation` nor the legacy `window.orientation` angle is available.

**New typed events on `EngineEvents`** (additive)

- `screen:fullscreen` with payload `{ active: boolean }` — fired by `RendererPlugin` on `fullscreenchange` / `webkitfullscreenchange` (entering, exiting, Esc, browser UI).
- `screen:orientation` with payload `{ type: OrientationType }` — fired by `RendererPlugin` on `screen.orientation.change`, falling back to `window.orientationchange` on browsers without the modern API.
- Listeners install during `RendererPlugin.install()` (gated behind `typeof document/window !== "undefined"` so node-environment tests are unaffected) and tear down in `onDestroy()`.

**Bug fix: `letterbox` now actually clips world content to the virtual rect**

`letterbox` and `expand` shared the same transform with no clip, so any game whose world is larger than the virtual rect (e.g. a side-scroller) would render world content into the letterbox bars whenever the host's aspect ratio didn't match virtual. The contract documented for `letterbox` ("leftover canvas painted with `backgroundColor` — bars are blank") was prose-only. Fullscreen made the leak obvious because it forces the container to the viewport's aspect ratio. Under `letterbox` the `FitController` now installs a `Graphics` mask on the stage covering `(0, 0, virtualWidth, virtualHeight)`, restoring the doc'd behaviour. `expand`, `cover`, and `stretch` deliberately don't clip (`expand` is the explicit opt-out for games drawing into bars; the other two cover the canvas already). No API change — existing games on `letterbox` should look the same on aspect-matched hosts and gain proper bar-clipping on mismatched ones.
