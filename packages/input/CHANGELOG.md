# @yagejs/input

## 0.5.0

### Minor Changes

- [#49](https://github.com/marco-lepore/yage/pull/49) [`bc3790d`](https://github.com/marco-lepore/yage/commit/bc3790dc4c31c42c4821cd275a9376a0830bb0db) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Real gamepad polling, analog sticks/triggers, and `listenForNextKey` support across devices.
  - `InputPollSystem` now polls `navigator.getGamepads()` each frame and routes button edges through the same internal path as keyboard/mouse, so `isPressed`, `isJustPressed`, hold-duration, and `listenForNextKey` all work uniformly across devices.
  - New gamepad codes for the action map under W3C standard mapping: `GamepadA/B/X/Y`, `GamepadLB/RB/LT/RT`, `GamepadSelect/Start`, `GamepadLeftStick/RightStick`, `GamepadDPadUp/Down/Left/Right`, `GamepadHome`. Non-standard mappings expose `GamepadButton{0..15}`.
  - New analog API: `getStick("left" | "right"): Vec2` (radial deadzone, magnitude clamped to 1.0) and `getTrigger("left" | "right"): number` (0..1). Reads from the active pad by default; pass `{ pad: index }` for explicit per-pad reads.
  - Active-pad model: a single pad is "active" at any time; auto-promotes on input activity (button press or stick/trigger above deadzone), with the current active pad's own activity protecting it from being stolen mid-press. `getActivePad()`, `setActivePad(index | null)`, and `onActivePadChanged(fn)` (replays current state on subscribe) round out the management surface.
  - Connect/disconnect events: `onGamepadConnected(fn)` and `onGamepadDisconnected(fn)` return disposers; `onGamepadConnected` replays currently-known pads on subscribe. `gamepads()` synchronously polls `navigator.getGamepads()` for ground truth (events don't fire until first button press per browser security). Polling-based discovery also fires connect events for already-plugged pads when the browser event missed.
  - New `InputConfig` options: `deadzones: { stick?, trigger? }`, `triggerThreshold`, `pollGamepads`. Trigger buttons (`GamepadLT`/`GamepadRT`) fire as button edges when their analog value crosses `triggerThreshold` (default 0.5).
  - Page-visibility safety: tab going hidden force-releases held gamepad codes so they don't appear stuck on return.
  - Synthetic API rework (breaking, pre-1.0): `fireGamepadButton(code, pressed)` now takes a code string (e.g. `"GamepadA"`) and routes through the real path so action queries see it. `fireGamepadAxis(side, value)` now takes a named axis (`"leftX"`, `"leftY"`, `"rightX"`, `"rightY"`, `"leftTrigger"`, `"rightTrigger"`). Pair `pollGamepads: false` with `DebugPlugin`'s `deterministicSeed` for reproducible inspector probes.

- [#52](https://github.com/marco-lepore/yage/pull/52) [`d998fc1`](https://github.com/marco-lepore/yage/commit/d998fc16746ee56ff3cad22a5fdf77b2ac19800b) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Input ergonomics: frame-deferred action edges, pointer/wheel consume primitives, listener parity, and UI auto-consume via the renderer's hit-test fallback.
  - **Frame-deferred action propagation (breaking, pre-1.0).** DOM-originated keyboard / pointer / wheel events now buffer onto an internal queue and apply at the next `Phase.EarlyUpdate` drain (via `InputPollSystem`). `isJustPressed`, `isJustReleased`, and `isPressed` see the edge on the frame _after_ the browser dispatch — single-frame latency, invisible to gameplay reading state at frame start. Synthetic injection (`fireKeyDown`, `firePointerDown`, `fireGamepadButton`, etc.) keeps applying state synchronously, so existing tests that drive the manager directly are unaffected. Tests that drive `dispatchEvent` and assert immediately need an explicit `manager._drainInputQueue()` (or a frame step) before assertions.
  - New `consumePointer(id)` / `isPointerConsumed(id)` primitive: marks a pointer as claimed for the rest of its event cycle (down → up). Suppresses the `MouseLeft`/`Middle`/`Right` action-map edges the pointer would otherwise drive. `pointerDown/Up/Move` listeners still fire — they're explicit user opt-ins. `consumeWheel()` is the per-frame analog for wheel.
  - New listener parity APIs: `onKeyDown(code, fn)`, `onKeyUp(code, fn)` (use `"*"` for any-key), `onAction(name, fn)`, `onActionReleased(name, fn)`, `onWheel(fn)`. All return a disposer, matching the existing pointer / gamepad listener pattern.
  - Scroll wheel support: `wheel` events are buffered and emitted as one-frame `WheelUp` / `WheelDown` / `WheelLeft` / `WheelRight` action codes (rebindable like keys; never linger in `pressedKeys`). New `InputConfig` options: `wheelInvertY` (flip vertical sign) and `preventDefaultWheel` (call `preventDefault()` on incoming wheel events; attaches the listener with `{ passive: false }`). Synthetic helper: `fireWheel(dx, dy)`.
  - Auto-consume integration: drain step queries the renderer's optional `hitTestUI(x, y)` for each `pointerdown` and adds the pointer to `consumedPointers` when the press lands on a UI-marked container — so taps on UIPanel backgrounds, UIText, or any custom Pixi container marked via `markPointerConsumeContainer` no longer fire gameplay action edges. Drag-through-up is consistent: the consume mark persists until the pointer's last button releases.

- [#51](https://github.com/marco-lepore/yage/pull/51) [`114d246`](https://github.com/marco-lepore/yage/commit/114d246820a88e68841a4f9cec2167c188269970) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Multi-pointer / touch support across the input layer.
  - New per-pointer state keyed by `pointerId`: every active mouse, pen, or finger gets its own tracked entry. `getPointers(): readonly PointerInfo[]` and `getPointer(id): PointerInfo | undefined` expose them; `PointerInfo` carries `{ id, screenPos, type, isPrimary, buttons, isDown }`.
  - `pointerType` (`"mouse" | "pen" | "touch"`) is now exposed on every tracked pointer so games can branch on input class (e.g. show or hide a hover indicator).
  - Per-pointer event hooks: `onPointerDown(fn)` / `onPointerUp(fn)` / `onPointerMove(fn)` each return a disposer. Up listeners also fire on `pointercancel`, so gesture-tracking code does not need to special-case it.
  - `MouseLeft` / `MouseMiddle` / `MouseRight` action codes now use any-pointer aggregation (mirrors the Tier 1 gamepad fix): two simultaneous pointers holding button 0 emit one down edge and one up edge, never spurious duplicates.
  - The singular `getPointerPosition()`, `getPointerScreenPosition()`, and `isPointerDown()` continue to report the **primary** pointer (the one the browser flagged `isPrimary`), so existing single-pointer call sites keep working unchanged. `isPointerDown()` now reflects "primary pointer has any of buttons 0/1/2 held" — buttons 3+ no longer set it.
  - Synthetic injection (`firePointerMove` / `firePointerDown` / `firePointerUp`) gains an optional second `opts?: { id?, type?, isPrimary? }` argument for driving non-primary or touch pointers in tests. Existing zero-arg / single-arg calls keep their previous semantics.
  - `InputStateSnapshot` (from `@yagejs/core`) now exposes a `pointers: PointerSnapshot[]` array next to `mouse`. `mouse` is preserved as a primary-pointer mirror for back-compat with existing inspector tooling.
  - `pointercancel` now drops the cancelled pointer entirely and releases the aggregate `MouseLeft`/`Middle`/`Right` edges it was holding — replaces the previous "clear all pointer buttons" handling, which over-cleared when only one of multiple touches was cancelled.

### Patch Changes

- Updated dependencies [[`cf617fe`](https://github.com/marco-lepore/yage/commit/cf617fe0f28db6ea1a5af7992b76dc19eec8cd0c), [`cf617fe`](https://github.com/marco-lepore/yage/commit/cf617fe0f28db6ea1a5af7992b76dc19eec8cd0c), [`bc3790d`](https://github.com/marco-lepore/yage/commit/bc3790dc4c31c42c4821cd275a9376a0830bb0db), [`d998fc1`](https://github.com/marco-lepore/yage/commit/d998fc16746ee56ff3cad22a5fdf77b2ac19800b), [`114d246`](https://github.com/marco-lepore/yage/commit/114d246820a88e68841a4f9cec2167c188269970)]:
  - @yagejs/debug@0.5.0
  - @yagejs/core@0.5.0

## 0.4.0

### Minor Changes

- [#45](https://github.com/marco-lepore/yage/pull/45) [`0711684`](https://github.com/marco-lepore/yage/commit/0711684b642da76cd29bf250eccc646d89360805) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Inspector deterministic test mode and per-package serialization plumbing for `Inspector.snapshot()`.
  - `InputManager` exposes synthetic input drivers consumed by the inspector — `fireKeyDown`/`fireKeyUp`, `firePointerMove`/`firePointerDown`/`firePointerUp`, `fireGamepadButton`/`fireGamepadAxis`, `fireAction`, `clearAll` — plus `snapshotState()` returning a stable view of pressed keys, active actions, mouse and gamepad state.
  - Synthetic actions are tracked separately (`syntheticPressedActions` / `syntheticActionStarts`) so `isPressed` / `isJustPressed` / `getHoldDuration` see fired actions even without a bound key. Mouse buttons and gamepad button/axis state are now tracked too, so `snapshotState()` is complete.
  - `InputPlugin` routes real DOM pointer events through the new `firePointerDown`/`Up` paths so production input goes through the same code path as inspector-driven input.
  - New `@yagejs/input/api` subpath that re-exports `InputManagerKey` and `InputConfig` for downstream packages that need the types without pulling the runtime.

### Patch Changes

- Updated dependencies [[`0711684`](https://github.com/marco-lepore/yage/commit/0711684b642da76cd29bf250eccc646d89360805), [`0711684`](https://github.com/marco-lepore/yage/commit/0711684b642da76cd29bf250eccc646d89360805)]:
  - @yagejs/core@0.4.0
  - @yagejs/debug@0.4.0

## 0.3.0

### Minor Changes

- [#36](https://github.com/marco-lepore/yage/pull/36) [`b3ed554`](https://github.com/marco-lepore/yage/commit/b3ed554e7cc60c1583a5379311fbf9e47ec373cb) Thanks [@marco-lepore](https://github.com/marco-lepore)! - `InputPlugin` now auto-wires to the current renderer with zero config. When
  `InputConfig.rendererKey` is not set, it resolves the new `RendererAdapterKey`
  from `@yagejs/core` — the canonical `RendererPlugin` registers itself there,
  so `new InputPlugin({ actions: {...} })` just works under responsive fit.
  - `InputConfig.rendererKey` stays as an override for custom renderers
    registered under a different `ServiceKey<RendererAdapter>`.
  - `RendererLike` is now a re-export alias of `RendererAdapter` from core.
    Existing `import type { RendererLike } from "@yagejs/input"` keeps working.
    Migration note: `RendererLike` is now a `type` alias, not an `interface`,
    so `interface MyRenderer extends RendererLike {}` no longer compiles —
    switch to `type MyRenderer = RendererLike & { ... }` (or import
    `RendererAdapter` directly from `@yagejs/core` and extend that).
    Declaration merging on `RendererLike` is likewise no longer supported.

  Register `RendererPlugin` before `InputPlugin` to pick up the auto-wiring.
  If input installs first, the resolve returns `undefined` and input falls
  back to raw canvas-relative CSS pixels (correct only when canvas CSS size
  equals virtual size).

- [#32](https://github.com/marco-lepore/yage/pull/32) [`c5e2656`](https://github.com/marco-lepore/yage/commit/c5e2656bd3dab4020a303e34dd77ccbd60ef4ca4) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Route pointer coordinates through the renderer so they land in virtual space.
  - When `InputConfig.rendererKey` is set and the resolved renderer exposes `canvasToVirtual(x, y)`, `InputPlugin` now passes canvas-relative CSS pixels through it before storing them on `InputManager`. Downstream consumers — `getPointerScreenPosition()`, `getPointerPosition()` via `Camera.screenToWorld` — receive correct virtual-space coordinates regardless of fit mode or canvas CSS scaling.
  - `RendererLike` gains an optional `canvasToVirtual?(x, y)` method. Absent implementations (older renderers, custom shims) fall through to the pre-existing raw-CSS-coords path, so this is backward compatible.
  - Fixes a latent bug where pointer coords were wrong whenever the canvas CSS size diverged from virtual size — previously unnoticeable when both matched (the old default), now critical under the renderer's responsive-by-default fit.

### Patch Changes

- Updated dependencies [[`69f8449`](https://github.com/marco-lepore/yage/commit/69f844942d1596228a6ed50a37ec8e6f1d821353), [`60d2067`](https://github.com/marco-lepore/yage/commit/60d20671e31230f5fcef127203efb127bdfedf92), [`b3ed554`](https://github.com/marco-lepore/yage/commit/b3ed554e7cc60c1583a5379311fbf9e47ec373cb)]:
  - @yagejs/core@0.3.0
  - @yagejs/debug@0.3.0

## 0.2.0

### Minor Changes

- [#21](https://github.com/marco-lepore/yage/pull/21) [`32b35dc`](https://github.com/marco-lepore/yage/commit/32b35dcc89b5e28fdb852a08127f0a6f06ded819) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Rework the camera system into an entity + layer-binding model, and give every scene its own container.
  - `InputManager._setCamera` is now the public `setCamera(camera)`, paired with `clearCamera()`. Games wire the camera in `onEnter` (and clear it in `onExit`) because `CameraEntity` is spawned per-scene; the engine cannot install it at plugin time.
  - `InputConfig.cameraKey` is removed. There is no singleton camera key anymore, so the auto-install path it fed no longer exists.

### Patch Changes

- Updated dependencies [[`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`32b35dc`](https://github.com/marco-lepore/yage/commit/32b35dcc89b5e28fdb852a08127f0a6f06ded819), [`7c0ced1`](https://github.com/marco-lepore/yage/commit/7c0ced138305b55473b98bf3302ff6a21e8860df), [`fc717ba`](https://github.com/marco-lepore/yage/commit/fc717bac2bc530a2c396da604d614f762d272232), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c)]:
  - @yagejs/debug@0.2.0
  - @yagejs/core@0.2.0
