---
"@yagejs/core": minor
---

Inspector deterministic test mode and per-package serialization plumbing for `Inspector.snapshot()`.

- New `Inspector` capabilities: full deterministic state via `snapshot()` / `snapshotJSON()` (stable-sorted), per-scene snapshots via `snapshotScene()`, recorded event log (`events.getLog()` / `clearLog()` / `setCapacity()` / `waitFor(pattern, { withinFrames, source })`), synthetic-input drivers (`input.keyDown`/`Up`, `mouseMove`/`Down`/`Up`, `gamepadButton`/`Axis`, `tap`/`hold`/`fireAction`), manual frame stepping (`time.freeze`/`thaw`/`step`/`setDelta`/`isFrozen`), seed control (`setSeed`, `createSceneRandom`), and PNG capture (`capture.png`/`dataURL`/`pngBase64`).
- Generic `addExtension(namespace, api)` / `getExtension<T>(namespace)` / `removeExtension(namespace)` so plugins can publish optional inspector helpers under their own namespace; extensions are cleared on `dispose()`.
- New deterministic RNG: `RandomService` (interface), `RandomKey` (scene-scoped service), `createRandomService(seed?)`, `globalRandom`, `normalizeSeed`, `createDefaultRandomSeed`. `setSeed` is intentionally off the public interface — game code can't reset a shared per-scene RNG mid-frame; only the Inspector reseeds via the internal subtype.
- New types exported from `index.ts`: `EngineSnapshot`, `WorldSceneSnapshot`, `WorldEntitySnapshot`, `ComponentStateSnapshot`, `UITreeSnapshot`, `UINodeSnapshot`, `PhysicsSnapshot`, `CameraSnapshot`, `InputStateSnapshot`, `EventLogEntry`, `InspectorTimeController`, `RandomService`.
- Scene-scoped DI now resolves `RandomKey` automatically when the engine starts; `Scene._setEntityEventObserver(...)` exposes a tooling-only entity-event tap consumed by the inspector log.
- Breaking: `EngineSnapshot.frameCount` removed (use `frame`). `RandomService` no longer exposes `setSeed` publicly (use `Inspector.setSeed`).
