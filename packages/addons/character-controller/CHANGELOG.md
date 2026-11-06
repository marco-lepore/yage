# @yagejs-addons/character-controller

## 0.1.0

### Minor Changes

- [#405](https://github.com/marco-lepore/yage/pull/405) [`c3def87`](https://github.com/marco-lepore/yage/commit/c3def870a6be3e5f913eec8f8b5168dbd7809008) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add the character-controller addon: platformer movement for a dynamic physics body.
  - `createPlatformer(entity, options?)` adds running, coyote time, buffered and variable-height jumps, air jumps, dashes, wall jumps, crouching, slides, and dropping through one-way platforms, with default tuning for a 16-pixel tile world.
  - It creates a feet-origin box body, or uses an existing dynamic body and box collider. `layers` and `mask` set the created collider's collision layers.
  - Down plus jump on a one-way platform drops through it, and `moves.drop()` serves a separate drop binding. `PlatformerDroppedEvent` reports the drop.
  - Ground, wall, headroom, ledge, and terrain queries count only surfaces the character's collider would collide with, so collision layers, sensors, and one-way platforms apply without extra query options.
  - `admissionPolicies` decide when a move may start and how landing restores air charges. `admission.setAirCharges()` and `refillAirCharges()` serve pickups.
  - `controller.speedScale` scales run speed and `controller.wallClingEnabled` turns wall sliding on and off while the game runs.
  - Every movement producer submits prioritized requests to one `MotionReconciler`, which writes the body's velocity once per step. Each component declares its update priority, so a game component added in any order runs between the controller and the reconciler.
  - `LedgeProbe` measures ledges and climb clearance for a game-owned climb, and `moves.consumeJumpPress()` lets such a move take a jump press from any input device. `MovingSurface` carries riders on kinematic platforms, and `CrushProbe` reports a character pushed into a wall.
  - Keyboard, gamepad, and pointer-zone input comes from `platformerControls()`. `input: null` gives AI or scripted control without `InputPlugin`.
  - `@yagejs/core`, `@yagejs/physics`, and `@yagejs/input` are required peers. Everything imports from the package root.

### Patch Changes

- Updated dependencies [[`c3def87`](https://github.com/marco-lepore/yage/commit/c3def870a6be3e5f913eec8f8b5168dbd7809008), [`504f688`](https://github.com/marco-lepore/yage/commit/504f6889ddba1db454afa85045b76d383c70f811), [`f3f2d71`](https://github.com/marco-lepore/yage/commit/f3f2d7163c1d8f3f67c402771a8ad297f64a0a83), [`5ffc62f`](https://github.com/marco-lepore/yage/commit/5ffc62f0cb8a73c92880a09c2101d52cedfdaf03), [`590c7d2`](https://github.com/marco-lepore/yage/commit/590c7d2f0a024c27dc3c37e2272c90a59c8e1b0f), [`590c7d2`](https://github.com/marco-lepore/yage/commit/590c7d2f0a024c27dc3c37e2272c90a59c8e1b0f), [`590c7d2`](https://github.com/marco-lepore/yage/commit/590c7d2f0a024c27dc3c37e2272c90a59c8e1b0f), [`2869e2a`](https://github.com/marco-lepore/yage/commit/2869e2a7888a6674e49c9af654ac22311cb2985b), [`960939a`](https://github.com/marco-lepore/yage/commit/960939a48fcfb30f73e3f8d85d0338197c827097), [`baf2d43`](https://github.com/marco-lepore/yage/commit/baf2d4317e36f284787de78422ecf20b9bdb3d75), [`1bdcdc6`](https://github.com/marco-lepore/yage/commit/1bdcdc629ca5d6219baa95c4cc75e217f377fa07)]:
  - @yagejs/input@0.13.0
  - @yagejs/physics@0.13.0
  - @yagejs/core@0.13.0
