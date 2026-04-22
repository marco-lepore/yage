---
"@yagejs/renderer": minor
---

Responsive canvas fit by default — the renderer now tracks its host element and re-maps the virtual rectangle on every resize.

- `RendererConfig.fit` is an optional override taking `{ mode: "letterbox" | "cover" | "stretch"; target?: HTMLElement }`. When omitted, the renderer defaults to `{ mode: "letterbox" }` against the configured `container` (or `canvas.parentElement`, or `document.body`). There is no "no-fit" code path anymore — fixed-size canvases are achieved by giving the container fixed CSS dimensions.
- `letterbox` preserves aspect inside the host with bars in `backgroundColor`. `cover` preserves aspect and fills (overflowing on one axis). `stretch` applies non-uniform scale.
- Runtime control on `RendererPlugin`: `setFit(options)` swaps modes/targets, the `fit` getter returns the current options, `canvasSize` returns the current CSS size.
- New `canvasToVirtual(x, y)` inverts the current stage transform — CSS pixels relative to the canvas top-left → virtual-space pixels. Name chosen to avoid clashing with the engine's existing "screen space" terminology (which means virtual viewport space, not DOM pixels).
- New `visibleVirtualRect` getter returns the on-screen sub-rect of virtual space (clamped to virtual bounds). Under `letterbox` / `stretch` it equals the full virtual rect; under `cover` it narrows on the long axis so HUDs can anchor to what players actually see while gameplay keeps using the full declared play area. `VirtualRect` is exported.
- New `croppedVirtualRects` getter returns the complement: 0–2 strips of virtual space that are currently off-screen. Empty under `letterbox` / `stretch`; under `cover` returns the top+bottom or left+right crop strips. Lets effects reason about what's beyond the visible edge — fog-of-war overlays at the crop boundary, off-screen-activity indicators, auto-panning cameras.
- Implementation uses `app.renderer.resize(hostW, hostH)` so hi-DPI stays correct via `resolution` + `autoDensity`, paired with a recomputed `stage.scale` / `stage.position` per mode.
- Teardown is wired into `onDestroy`: the `ResizeObserver` is disconnected before `app.destroy()`. Headless environments (no DOM target, no `document`) fall back to a one-shot transform against the initial `width × height` and install no observer.
