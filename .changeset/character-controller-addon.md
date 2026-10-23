---
"@yagejs-addons/character-controller": minor
---

Add the character-controller addon: platformer movement for a dynamic physics body.

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
