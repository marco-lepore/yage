# @yagejs-addons/character-controller

Runnable example: [movement playground](https://examples.yage.dev/character-controller.html).
Source: `examples/src/character-controller/`. Shows default and nimble tuning,
a dash admission policy, air-charge refill, one-way platforms with
drop-through, a moving platform, and wall jumps. Its `LedgeClimb` component
(`ledge.ts`) is a game-owned catch, hang, and climb built on `LedgeProbe`.

## Exports

One entry, `@yagejs-addons/character-controller`:

- Assembly: `createPlatformer(entity, options?) -> PlatformerCharacter`,
  `CreatePlatformerOptions`, `defaultPlatformerTuning(overrides?) ->
Readonly<PlatformerConfig>`, `DEFAULT_PLATFORMER_TUNING`.
- Components: `PlatformerController`, `PlatformerMoves`, `MoveAdmission`,
  `MotionReconciler`, `GroundProbe`, `WallProbe`, `Stance`, `TerrainAssist`,
  `PlatformerInput`, `LedgeProbe`, `MovingSurface`, `CrushProbe`.
- Events: `PlatformerLandedEvent`, `PlatformerJumpedEvent`,
  `PlatformerDashedEvent`, `PlatformerSlidEvent`, `PlatformerDroppedEvent`,
  `PlatformerCrushedEvent`.
- Input: `platformerControls(actions?)`, `DEFAULT_PLATFORMER_ACTIONS`,
  `PlatformerInputBinding`, `InputBinding`, `PlatformerInputTarget`,
  `PlatformerActions`, `PlatformerPointerViewport`.
- Motion model: `MotionIntent`, `MotionIntentHandle`, `DurableIntentHandle`,
  `MotionAxis`, `MotionResolution`, `MotionResolver`, `RefusedIntent`,
  `MotionQueue`, `resolveMotion`, `validateMotionIntent`,
  `CHARACTER_CONTROLLER_PRIORITY` (0).

Peers: `@yagejs/core`, `@yagejs/physics`, and `@yagejs/input`, all required.
A character created with `input: null` needs no InputPlugin. No renderer
dependency.

## Minimal character

```ts
import { Engine, Entity, Scene, Transform, Vec2 } from "@yagejs/core";
import {
  PhysicsPlugin,
  RigidBodyComponent,
  ColliderComponent,
} from "@yagejs/physics";
import { InputPlugin } from "@yagejs/input";
import {
  createPlatformer,
  platformerControls,
} from "@yagejs-addons/character-controller";

class Floor extends Entity {
  setup(): void {
    this.add(new Transform({ position: new Vec2(0, 200) }));
    this.add(new RigidBodyComponent({ type: "static" }));
    this.add(
      new ColliderComponent({ shape: { type: "box", width: 800, height: 20 } }),
    );
  }
}
class Player extends Entity {
  setup(): void {
    this.add(new Transform());
    createPlatformer(this);
  }
}
class Game extends Scene {
  readonly name = "game";
  onEnter(): void {
    this.spawn(Floor);
    this.spawn(Player);
  }
}
const engine = new Engine();
engine.use(new PhysicsPlugin());
engine.use(new InputPlugin({ actions: platformerControls() }));
await engine.start();
await engine.scenes.push(new Game());
```

The Transform is at the feet, upright, world scale 1. Scale, rotate or flip a
visual child. The helper creates a 16×44 dynamic box, offset `(0, -22)`, fixed
rotation, CCD, zero friction, zero engine gravity. Controller gravity defaults
to 980 px/s².

`createPlatformer` returns `{ body, collider, input, controller, admission,
moves, motion, ground, wall, stance }`, all public components. It throws
before changing the entity when: the Transform is rotated or scaled;
PhysicsPlugin is missing; InputPlugin is missing and `input` is not `null`;
the entity already has a `MotionReconciler`; or a tuning number is invalid.

`CreatePlatformerOptions`:

| Option                                     | Type                                         | Default                          |
| ------------------------------------------ | -------------------------------------------- | -------------------------------- |
| `tuning`                                   | `Partial<PlatformerConfig>`                  | all defaults                     |
| `input`                                    | `InputBinding \| null`                       | keyboard, gamepad, pointer zones |
| `layers`, `mask`                           | collision layer bits of the created collider | all layers                       |
| `admissionPolicies`                        | `MoveAdmissionPolicies`                      | none                             |
| `resolveMotion`                            | `MotionResolver`                             | `resolveMotion`                  |
| `terrain`                                  | `boolean`: slopes, steps, ground snap        | `true`                           |
| `crush`                                    | `boolean`: adds `CrushProbe`                 | `false`                          |
| `dash`, `wallJump`, `slide`, `dropThrough` | `boolean`: standard moves                    | `true`                           |

Existing body: add a `RigidBodyComponent` (dynamic, `gravityScale: 0`,
`fixedRotation: true`) and one box `ColliderComponent` with offset
`{ x: 0, y: -height / 2 }` and `friction: 0` (not checked) before calling
`createPlatformer`.
The body size comes from the box. Passing `tuning.bodyWidth`,
`tuning.bodyHeight`, `layers`, or `mask` then throws. A missing component, a
non-dynamic body, a nonzero gravity scale, unlocked rotation, a non-box shape,
a second collider, or another offset throws.

## Tuning and standard moves

Numbers are finite and nonnegative; charge counts are integers. Distances use
pixels, speeds px/s, accelerations px/s², durations seconds, slope angles
degrees. Configs are copied at construction.

| Behavior                                   | Defaults                                                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Running                                    | runSpeed 190, groundAcceleration 1700, airAcceleration 1500                                                                          |
| Momentum while holding toward excess speed | groundShed 1800, airShed 340                                                                                                         |
| Gravity                                    | gravity 980, riseMultiplier 1, apexMultiplier 0.5, fallMultiplier 1.7, apexSpeed 60, terminalFallSpeed 900                           |
| Ground contact                             | groundPressSpeed 40, groundedRiseTolerance 40                                                                                        |
| Jump                                       | jumpSpeed 434, jumpHoldWindow 0.2, jumpCutSpeed 240, doubleJumpSpeed 360, airJumps 1                                                 |
| Forgiveness                                | coyoteTime 0.1, pressBufferWindow 0.12, wallCoyoteTime 0.1                                                                           |
| Dash                                       | dashSpeed 520, dashDuration 0.27, dashCooldown 0.6, airDashes 1                                                                      |
| Drop-through                               | dropThroughTime 0.25                                                                                                                 |
| Crouch/slide                               | crouchHeight 30, crouchAcceleration 575, slideSpeed 450, slideExitSpeed 190, slideMinSpeed 140, slideRestTime 0.5                    |
| Wall                                       | wallSlideSpeed 120, wallJumpSpeedX 370, wallJumpSpeedY 434, wallJumpLockout 0.16                                                     |
| Body/probes                                | bodyWidth 16, bodyHeight 44, groundProbeInset 1, groundProbeDistance 3, wallProbeDistance 4, wallProbeHeight 20, wallProbeCentreY 15 |
| Terrain                                    | maxSlopeAngle 45, groundSnapDistance 6, ledgeStepHeight 6, ledgeMinWidth 4                                                           |

Jump selection: drop-through (down held on a one-way platform), then
ground/coyote, then wall, then air. Releasing jump during the hold window caps
upward speed; holding through it keeps the rest of the jump. An air jump never
reduces a faster rise. Landing refills air charges. Dash cooldown starts on
admission; a jump can interrupt a dash. A slide starts when crouching while
running; held crouch does not repeat it. Wall slide needs held direction
toward a detected wall. Horizontal input is in [-1, 1].

Runtime settings on `PlatformerController`:

- `speedScale: number` (default 1): multiplies run speed. Setting a negative
  or non-finite value throws.
- `wallClingEnabled: boolean` (default true): falling against a held wall
  slides at `wallSlideSpeed`.

`PlatformerMoves`: `jump()`, `dash()`, and `drop()` buffer presses for
`pressBufferWindow`. `setJumpHeld(boolean)` controls short hops. `cancel()`
withdraws this producer's commands and held moves. `resetInput()` discards
buffered presses and releases jump; active moves and cooldowns continue.
`consumeJumpPress(): boolean` takes a buffered jump press for a game-owned
move and returns whether one was waiting. Readable: `dashing`, `wallJumping`,
`dashReady`. Standard moves submit at priority 10; a directly constructed
`PlatformerMoves` accepts `priority`.

## One-way platforms and collision

A collider with `oneWay: {}` is a one-way platform. Down plus jump, or
`moves.drop()`, on one-way ground calls `collider.dropThrough(dropThroughTime)`,
spends the ground jump until landing, and emits `PlatformerDroppedEvent`. It
needs one-way support, an unspent ground jump, and `canStartMove("dropThrough")`.
It does not need standing headroom. `dropThrough: false` turns it off; down
plus jump is then an ordinary jump. A custom drop producer checks
`admission.canDropThrough`, then calls `admission.spendDropThrough()` (throws
when unavailable) and the collider's `dropThrough(seconds)`.

Every probe queries with `solidFor: collider` (see the physics reference): a
surface counts only if the character's collider would collide with it.
Collision layers, sensors, and both contact filters apply. A one-way
platform's underside is not a ceiling and its side is not a wall. Passing
through a surface is not a landing and restores no charges.

`ground.supportOneWay` reports whether the sampled support has a `oneWay`
config. `controller.onOneWay` also requires classified ground contact. Both
read authored configuration; a replaced contact filter can change whether a
platform permits dropping. Terrain assistance can leave a small gap above a
surface; use `controller.grounded` and `PlatformerLandedEvent` for contact.

## Move eligibility and air charges

`MoveAdmissionPolicies` has two optional pure, synchronous callbacks:

- `canStartMove(move: PlatformerMove, state: MoveAdmissionState): boolean`:
  extra eligibility for `groundJump`, `airJump`, `wallJump`, `dash`, `slide`,
  or `dropThrough`. It cannot bypass contact, headroom, charge, or cooldown
  checks. Readiness queries also call it, so it can run more than once per
  step. Spend stamina in move events, not here.
- `landingCharges(state: MoveAdmissionState): AirMoveCharges`: counts after
  ground contact, including the first contact after spawn. Default restores
  `tuning.airJumps` and `tuning.airDashes`. Runs once per landing. Returning
  `state.airCharges` keeps the remaining charges.

`MoveAdmissionState` is a detached snapshot: `grounded`, `onOneWay`,
`crouched`, `blocked`, remembered `wallSide` (-1/0/1), `airCharges: { jumps,
dashes }`. Callback errors and invalid results are attributed and rethrown
before admission changes charges. Counts must be nonnegative safe integers.

`admission.airCharges` returns a copy. `setAirCharges({ jumps?, dashes? })`
sets selected counts after validating both. Counts may exceed the tuning
defaults. `refillAirCharges()` restores both tuned counts without the landing
policy. Neither resets dash cooldown, starts a move, or restores a ground or
wall jump. A new airborne character has zero air charges until ground contact
or an explicit write. `admission.jumpsTaken` only counts up.

Policy-denied presses stay buffered until their normal expiry. Air jumps
need the character to be airborne, even when a policy denies ground jumps.

## Input

`input` omitted: keyboard, gamepad, and pointer zones. Pass
`platformerControls()` to InputPlugin; missing action names log a warning.
Bindings: A/D, arrows, left stick, D-pad move; S/down crouches;
Space/W/up/gamepad A jump; Shift/gamepad B dash; down plus jump drops.

With a renderer, pointer presses in the left quarter move left, the next
quarter move right, and the right half jump. A press keeps its role until
release or an input reset. UI-consumed presses are ignored. The zones draw
nothing. `new PlatformerInputBinding()` without a viewport callback has no
zones; use it with the virtual-controls addon, which drives the same actions.

`InputManager.clearAll()` clears held direction and buffered jump, dash, and
drop presses of a device binding, including presses polled during a
zero-time step. A started dash and its cooldown continue.

A custom `InputBinding` implements `bind(input, target)`, `poll()`,
`dispose()`, and optional `actionNames()`. It replaces every default device.
Disable disposes it; enable binds it again. Disabling `PlatformerInput` also
clears held direction and buffered presses and releases jump, which cuts a
held jump short; a dash or wall jump under way finishes.
`input: null` constructs no
binding and needs no InputPlugin. Drive `character.input` with
`setDirection(-1..1)`, `setDown(boolean)`, `setJumpHeld(boolean)`, `jump()`,
`dash()`, and `drop()`. Scripted input ignores device resets; call
`moves.resetInput()` to clear its presses.

## Update order and custom assembly

Each component declares a static `updatePriority`, so the order inside the
character's fixed step does not depend on add order:

| Priority | Component                  |
| -------- | -------------------------- |
| -40      | `GroundProbe`, `WallProbe` |
| -30      | `PlatformerInput`          |
| -20      | `PlatformerController`     |
| -15      | `MoveAdmission`            |
| -10      | `PlatformerMoves`          |
| 0        | game components (default)  |
| 100      | `MotionReconciler`         |
| 110      | `CrushProbe`               |

A game component at the default priority reads this step's probe and
controller state and submits before the reconciler writes velocity.
`updatePriority` orders components within one entity only; entities update in
spawn order, which is why moving surfaces spawn before riders.

Each component is constructible on its own: `new GroundProbe({ tuning })`,
`new WallProbe({ tuning })`, `new Stance({ tuning })`,
`new TerrainAssist({ ground, tuning })`,
`new MotionReconciler(terrain?, resolveMotion?)`, `new PlatformerInput(binding?)`,
`new PlatformerController({ motion, ground, stance, wall, input, tuning })`,
`new MoveAdmission({ controller, stance, motion, tuning, policies? })`,
`new PlatformerMoves({ motion, controller, admission, tuning, priority?, dash?,
wallJump?, slide?, dropThrough? })`. They need the entity's body and collider
in `onAdd`. Add `PlatformerMoves` before `PlatformerInput`: the input
component finds it when added and throws without it. Custom slide producers call `admission.spendSlide()` after
admission to start the slide rest timer.

## Shared motion ownership

Only `MotionReconciler` writes character velocity. Producers submit before it:

- `submit(intent)`: this step only.
- `submitOnce(intent)`: next advancing resolution, consumed even if refused.
- `submitDurable(intent)`: repeated until `handle.end()` or `handle.cancel()`.

An intent has `source`, `axis` (`x`/`y`), `target`, `acceleration`,
`priority`; optional `shed`, `frame` (`world` default, `surface`, `launch`),
`terrain` (`grounded`). The default resolver picks the highest priority per
axis; equal winners throw. Acceleration and shed may be `Infinity` for an
immediate target; other numbers must be finite. `refusedLastStep` names the
overridden sources. `resolveMotion` replaces the arbitration; resolver errors
are attributed and rethrown, and returned velocities must be finite.

Running, gravity, and wall slide submit at priority 0. A glide is a `y`
intent between 0 and 10 that holds the fall speed down:

```ts
import { Component } from "@yagejs/core";
import { MotionReconciler } from "@yagejs-addons/character-controller";

class Glide extends Component {
  private readonly motion = this.sibling(MotionReconciler);

  fixedUpdate(): void {
    if (this.motion.velocityY < 0) return;
    this.motion.submit({
      source: "glide",
      axis: "y",
      target: 60,
      acceleration: 2000,
      priority: 5,
    });
  }
}
```

Surface targets are relative to the moving support. Launch adds only upward
support motion; ground steering carries horizontal platform velocity into
flight. `motion.ownVelocityX` is running speed relative to the support;
`velocityX/Y` are world velocity. Custom moves opt into terrain correction
with `terrain: "grounded"`.

Zero-time steps keep commands and holds without moving or consuming them.
Disabling the reconciler clears its queue. `yieldToSolver(velocity,
gravityScale)` clears requests and lets physics act; `reclaim(at?)` restores
control and can teleport with zero velocity. A higher-priority request
overrides an axis but does not cancel another producer's timers; call
`moves.cancel()` when interrupting standard moves. No controller state is a
save root; recreate the character when restoring a saved spawn position.

## Events

`PlatformerLandedEvent`: landing after the initial contact classification.
`PlatformerJumpedEvent`: `{ kind: "ground" | "air" | "wall" }`.
`PlatformerDashedEvent`: `{ direction: -1 | 1 }`.
`PlatformerSlidEvent`: slide burst.
`PlatformerDroppedEvent`: drop through a one-way platform.
`PlatformerCrushedEvent`: `{ surface, obstruction, direction }`.
No event applies damage, audio, particles, or animation.

## Ledges

Ledge catch, hang, and climb are game-owned moves. `new LedgeProbe({ tuning:
{ ledgeHandHeight, ledgeGrabReach, ledgeGrabTolerance } })` needs a box
standing collider and queries as the character:

- `find(side: -1 | 1): LedgeContact | undefined`: a flat ledge top within
  `ledgeGrabTolerance` of the hands, its outside face within reach, and a clear
  path from the body to hang, raised, and standing points.
- `points(contact, dt?) -> { hang, raised, stand }`: feet positions, predicted
  `dt` seconds ahead on a moving ledge.
- `clear(from, to, ignore?)`: standing body fits at `to` and sweeps there.
- `clearStep(from, to, contact, dt)`: one climb step stays clear while the
  ledge moves.

A climb component submits `x` and `y` intents above priority 10 toward each
point and blocks standard moves with `canStartMove` while active. A jump
press then stays in the moves' buffer; `moves.consumeJumpPress()` takes it
for the climb, from any input device.
`admission.recordLedgeJump()` records a jump away from a held ledge: it counts
in `jumpsTaken` and consumes ground/coyote and current wall-jump eligibility
without spending an air charge. It performs no checks, submits no motion, and
emits no event; call it once per departure.

## Moving platforms and crushing

`new MovingSurface({ from, to, speed })` moves an upright kinematic body back
and forth between two world points. Spawn it before riders. Upward support
velocity adds to jump height; downward does not reduce it. Entity time scale
changes path speed and carry velocity together; time scale 0 stops both.
Riders keep their place on the platform at any scene time scale, through
turns and scene freezes.

`CrushProbe` (`crush: true`) emits `PlatformerCrushedEvent` when a translating
box pushes the character into a fixed opposing face. Pushes respect collision
groups and contact filters. Rotating supports, angled wedges, and two moving
blockers are not detected.
