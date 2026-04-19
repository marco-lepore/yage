---
"@yagejs/debug": minor
---

Expose camera and layer diagnostics on `window.__yage__.inspector`.

- `inspector.getLayerTransform(sceneName, layerName)` returns the current `{ x, y, scaleX, scaleY, rotation }` of a scene's layer container, or `undefined` if the scene or layer is missing.
- `inspector.getCameraStack()` returns one entry per `CameraComponent` in the scene stack: `{ scene, name, priority, enabled }`.

Both are registered by `DebugPlugin` when it installs, so E2E suites and tools no longer need fixture-local helpers to read back camera/layer state.
