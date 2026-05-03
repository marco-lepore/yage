---
"@yagejs/debug": minor
---

Add `DebugPlugin` `startFrozen` option for true frame-zero determinism.

`new DebugPlugin({ startFrozen: true })` stops Pixi's ticker during plugin
`install()` — _before_ `Engine.start()` calls `loop.start()` — and brings
up the `DebugClock` already in frozen state. Pair with `deterministicSeed`
for E2E replay.

**Why:** previously the recommended pattern was `await engine.start();
inspector.time.freeze();`. Pixi auto-starts the ticker inside
`Application.init()` (which `RendererPlugin.install` awaits), so any frame
that ticked between then and the user-space `freeze()` mutated physics /
input clocks non-deterministically. Snapshots taken right after the
freeze were therefore _not_ bit-identical across runs — visible as a flaky
`inspector-determinism.spec.ts` on slow CI runners.

`startFrozen` closes the window: by the time `onStart()` runs and the user
ever sees `await engine.start()` resolve, the engine has ticked zero
frames. `inspector.time.thaw()` resumes auto-mode normally.

Updated `examples/src/platformer.ts` to read `__YAGE_START_FROZEN__` into
`startFrozen` instead of calling `freeze()` after `engine.start()`.
