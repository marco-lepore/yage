---
"@yagejs/core": minor
---

Inspector improvements for verifying games headlessly: default component introspection, awaitable stepping, stall detection, and event-log control.

- Component snapshots now include a component's public fields and getters even when it defines no `serialize()`. `inspector.getComponentData()` and `inspector.snapshot()` show live state by default instead of `null`.
- Added `inspector.time.stepUntil(predicate, { maxFrames })` and `inspector.time.stepAsync(frames)` — awaitable stepping that lets async work such as scene transitions advance between frames while the clock is frozen. `stepUntil` throws if the predicate is not met within `maxFrames` (default 600).
- Added `inspector.time.isAdvancing(withinMs)` — reports whether real frames are ticking, a stall signal distinct from `isFrozen()`.
- Added `inspector.events.setEnabled(enabled)` and `inspector.events.isEnabled()` to turn Inspector event logging on or off at runtime; turning it off stops per-event allocation.
- `inspector.snapshotScene(nameOrId)` now accepts a scene's name, not just its internal id, and `inspector.getSceneStack()` entries include the scene id.
