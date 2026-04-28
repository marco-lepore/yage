---
"@yagejs/debug": minor
---

Inspector deterministic test mode and per-package serialization plumbing for `Inspector.snapshot()`.

- `DebugPlugin` now wires the manual `DebugClock` into `Inspector.attachTimeController(...)` so `inspector.time.freeze()/step()` works while the plugin is active, and turns on event-log recording via `inspector.setEventLogEnabled(true)` during `onStart`.
- `DebugConfig.deterministicSeed?: number` opt-in: when set, every scene's RNG is initialized to this seed via `inspector.setDefaultSceneSeed(...)`. Leave undefined for normal debug builds; set it from test fixtures so replays start from a known RNG state. The previous unconditional fixed seed is gone.
- Renderer-aware diagnostics (`getLayerTransform`, `getCameraStack`) are now published via `inspector.addExtension("debug", ...)` and exposed as `DebugDiagnostics` — fetch with `inspector.getExtension<DebugDiagnostics>("debug")`. The plugin removes the extension on `onDestroy`, so they no longer leak past plugin teardown.
- The `Period` step hotkey advances one frame through the same `DebugClock` the inspector uses, keeping the manual timeline coherent across hotkey + programmatic stepping.
