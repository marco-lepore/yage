# @yagejs-addons/character-controller

Runnable example: [movement playground](https://examples.yage.dev/character-controller.html).
Source: `examples/src/character-controller/`. Demonstrates default and custom
tuning, dash admission policy, air-charge refill, and one-way drop-through.
The camera follows a scrolling course with repeated steps and alternating ramps.
`[` / `]` visit stations; `R` restarts the selected station. Hold `G` and jump
toward a ledge to climb. The example's `LedgeClimb` component supplies the move;
`LedgeProbe` supplies geometry and clearance.

## Entries

- `.`: `MotionIntent`, `MotionIntentHandle`, `DurableIntentHandle`, `MotionAxis`,
  `MotionResolution`, `MotionResolver`, `RefusedIntent`, `MotionQueue`, `resolveMotion`,
  `validateMotionIntent`, `CHARACTER_CONTROLLER_PRIORITY` (0). No engine imports.
- `/platformer`: `createPlatformer(entity, options?) -> PlatformerCharacter`,
  `defaultPlatformerTuning(overrides?) -> Readonly<PlatformerConfig>`,
  `DEFAULT_PLATFORMER_TUNING`, `installPlatformer(entity, setup)`,
  `PlatformerInstallation`, `PlatformerController`, `PlatformerMoves`,
  `MoveAdmission`, `MotionReconciler`, `GroundProbe`, `WallProbe`, `Stance`,
  `TerrainAssist`, `LedgeProbe`, `MovingSurface`, `CrushProbe`, events and types.
- `/input`: `platformerControls(actions?)`, `DEFAULT_PLATFORMER_ACTIONS`,
  `PlatformerInputBinding`, `PlatformerInput`, `InputBinding`,
  `PlatformerInputTarget`, `PlatformerActions`, `PlatformerPointerViewport`.

Physics and input are optional peers for root-only consumers. `/platformer`
requires physics; device input requires InputPlugin. No renderer dependency.

## Minimal character

```ts
import { Engine, Entity, Scene, Transform, Vec2 } from "@yagejs/core";
import {
  PhysicsPlugin,
  RigidBodyComponent,
  ColliderComponent,
} from "@yagejs/physics";
import { InputPlugin } from "@yagejs/input";
import { createPlatformer } from "@yagejs-addons/character-controller/platformer";
import { platformerControls } from "@yagejs-addons/character-controller/input";

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

Add rendering separately. The character Transform is at the feet, upright,
with world scale 1. Scale, rotate or flip a visual child. The helper creates a
16×44 dynamic box, offset `(0, -22)`, fixed rotation, CCD, zero friction and
zero engine gravity. Controller gravity defaults to 980 px/s².

`createPlatformer` returns `body`, `collider`, `input`, `controller`, `moves`,
`motion`, `ground`, `wall`, `stance`, and `admission`. All are public components.

Options: `tuning?: Partial<PlatformerConfig>`, `input?: InputBinding | null`,
`collision?: { solid?: number; volume?: number; wall?: number }`,
`collisionGroups?: number`, `terrain?: boolean` (true), `crush?: boolean`
(false), `dash?: boolean`, `wallJump?: boolean`, `slide?: boolean` (all true),
`limit?: SpeedLimitView`, `fall?: FallHoldView`, `resolveMotion?: MotionResolver`,
`admissionPolicies?: MoveAdmissionPolicies`.
`collisionGroups` is the character collider's packed membership/filter from
`CollisionLayers.interactionGroups(membership, filter)`.

## Tuning and standard moves

Numbers are finite and nonnegative; charge counts are integers. Distances use
pixels, speeds px/s, accelerations px/s², durations seconds, slope angles degrees.
Configs are copied. Supply overrides at construction.

| Behavior                                   | Defaults                                                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Running                                    | runSpeed 190, groundAcceleration 1700, airAcceleration 1500                                                                          |
| Momentum while holding toward excess speed | groundShed 1800, airShed 340                                                                                                         |
| Gravity                                    | gravity 980, riseMultiplier 1, apexMultiplier 0.5, fallMultiplier 1.7, apexSpeed 60, terminalFallSpeed 900                           |
| Ground contact                             | groundPressSpeed 40, groundedRiseTolerance 40                                                                                        |
| Jump                                       | jumpSpeed 434, jumpHoldWindow 0.2, jumpCutSpeed 240, doubleJumpSpeed 360, airJumps 1                                                 |
| Forgiveness                                | coyoteTime 0.1, pressBufferWindow 0.12, wallCoyoteTime 0.1                                                                           |
| Dash                                       | dashSpeed 520, dashDuration 0.27, dashCooldown 0.6, airDashes 1                                                                      |
| Crouch/slide                               | crouchHeight 30, crouchAcceleration 575, slideSpeed 450, slideExitSpeed 190, slideMinSpeed 140, slideRestTime 0.5                    |
| Wall                                       | wallSlideSpeed 120, wallJumpSpeedX 370, wallJumpSpeedY 434, wallJumpLockout 0.16                                                     |
| Body/probes                                | bodyWidth 16, bodyHeight 44, groundProbeInset 1, groundProbeDistance 3, wallProbeDistance 4, wallProbeHeight 20, wallProbeCentreY 15 |
| Terrain                                    | maxSlopeAngle 45, groundSnapDistance 6, ledgeStepHeight 6, ledgeMinWidth 4                                                           |

Jump selection: ground/coyote, then wall, then air. Release during the ground
jump hold window caps upward speed; holding through the window preserves the
rest of the jump. An air jump never reduces a faster existing rise. Landing
refills air charges. Dash cooldown starts on admission, and a jump can interrupt
a dash. Slides start when crouching while running; held crouch alone does not
repeat the burst. Wall slide requires holding toward a detected wall. Analog
horizontal input is in [-1, 1].

`moves.jump()` and `moves.dash()` buffer requests. `moves.setJumpHeld(boolean)`
controls short hops. `moves.cancel()` withdraws this producer's pending commands
and held moves. `moves.dashing`, `wallJumping`, `dashReady` are readable.
`moves.resetInput()` discards buffered jump/dash presses and releases jump input;
active moves and cooldowns continue.
Standard move priority is 10; low-level `PlatformerMoves` accepts `priority`.

## Move eligibility and air charges

`MoveAdmissionPolicies` has two optional pure, synchronous callbacks:

- `canStartMove(move: PlatformerMove, state: MoveAdmissionState): boolean`:
  additional eligibility for `groundJump`, `airJump`, `wallJump`, `dash`,
  `slide`, or `dropThrough`. Omit to allow every mechanically available move. It cannot bypass
  contact, headroom, charge, or cooldown checks. Readiness queries also use it;
  it can run more than once per step. Do not spend stamina here; use move events.
- `landingCharges(state: MoveAdmissionState): AirMoveCharges`: counts after
  ground contact, including the first contact after spawn. Omit to restore
  `tuning.airJumps` and `tuning.airDashes`. Runs once per airborne-to-ground
  transition, not every grounded step. Returning `state.airCharges` keeps the
  remaining charges. Returning zeros disables automatic air-move refills.

`MoveAdmissionState` is a detached snapshot with `grounded`, `onOneWay`, `crouched`,
`blocked`, remembered `wallSide` (-1/0/1), and `airCharges: { jumps, dashes }`.
Callback errors and invalid return values are attributed and rethrown before
admission spends or replaces charges. All counts must be nonnegative safe
integers. A policy may read live game state through its closure.

`admission.airCharges` returns a detached copy. `setAirCharges({ jumps?, dashes? })`
sets selected counts; omitted fields retain their values. Both fields are
validated before either changes. Counts may exceed the tuning defaults.
`refillAirCharges()` restores both tuned counts without invoking the landing
policy. Neither operation resets dash cooldown, starts a move, or restores a
ground/wall jump. New airborne characters start with zero air charges until
ground contact or an explicit charge write.

`moves.dashReady` includes enablement, solver ownership, cooldown, mechanical
admission, and the game policy. Policy-denied presses remain buffered until
their normal expiry. Jump selection still tries ground, wall, then air.
Air jumps require being airborne, even when a policy denies ground jumps.

Pass `admissionPolicies` to `createPlatformer` or `installPlatformer` alongside
its `admission` tuning. Direct construction uses `new MoveAdmission({
controller, stance, motion, tuning, policies })`. Custom slide producers call
`admission.spendSlide()` after admission to start the slide rest timer.

### Custom drop-through and ledge jumps

`ground.supportOneWay: boolean` reports whether the sampled walkable support
has `ColliderComponent.config.oneWay`. `controller.onOneWay: boolean` also
requires classified ground contact. These describe authored configuration;
replacing a platform's contact filter can change whether it permits dropping.

`admission.canDropThrough: boolean` requires one-way ground contact, unspent
ground-jump eligibility, and `canStartMove("dropThrough", state)`. It does not
require standing headroom or permission for `groundJump`.
`admission.spendDropThrough(): void` checks eligibility, then consumes the
ground/coyote jump until landing without changing `jumpsTaken` or air charges.
An unavailable drop throws before changing state.

In a custom move producer, handle the drop input before forwarding ordinary
jump input. After admission, call the character collider's `dropThrough(seconds)`
and submit any desired downward motion through `MotionReconciler`. The game
owns the binding, duration, interruption rules, and events; the standard runner
does not select drop-through automatically. When interrupting standard moves,
call `moves.cancel()` to clear their active motion and buffered presses.

`admission.recordLedgeJump(): void` records a departure already authorized by
the game's ledge hold. It increments `jumpsTaken`, consumes ground/coyote and
current wall-jump eligibility, and leaves air charges unchanged. It deliberately
performs no contact, headroom, or `canStartMove` checks: ledge hold eligibility
belongs to the custom traversal. Call exactly once per accepted departure;
repeated calls each count a jump. It submits no motion and emits no event.
Use this instead of `spendWallJump()` when a held ledge authorizes departure
without ordinary wall-jump eligibility. New wall contact restores wall-jump
eligibility; landing restores ground-jump eligibility.

## Input

`input` omitted uses keyboard/gamepad and pointer zones. Pass
`platformerControls()` to InputPlugin; missing action names produce a warning.
Bindings: A/D or arrows and left stick/D-pad move, S/down crouches,
Space/W/up/gamepad A jumps, Shift/gamepad B dashes.

With a renderer adapter, pointer presses in the left quarter move left, the
next quarter move right, and the right half jump. A press retains its role
until release or an input reset. Mouse and multi-touch use the same zones; already-consumed UI
presses are ignored. These zones draw nothing. Use the virtual-controls addon
for visible buttons and a stick, and a `PlatformerInputBinding` without a
viewport callback to disable the built-in zones. Both read the same action map.
Without a renderer, the default binding has no pointer zones; a custom binding
can supply viewport coordinates.

With a device binding, `InputManager.clearAll()` also clears movement intent
and buffered move presses, including presses polled during a zero-time step.
An already-started dash and its cooldown continue. Scripted input (`input: null`)
is independent of device resets; use `moves.resetInput()` to clear its presses.

A custom `InputBinding` implements `bind(input, target)`, `poll()`, `dispose()`
and optional `actionNames()`. It replaces all default devices. Bindings belong
to one character; lifecycle disable disposes them, enable binds them again.
`input: null` constructs no binding and requires no InputPlugin. Drive the
returned input via `setDirection(-1..1)`, `setDown(boolean)`,
`setJumpHeld(boolean)`, `jump()` and `dash()`.

## Custom assembly

`installPlatformer` requires an existing upright dynamic body, zero gravity,
fixed rotation, zero friction and one feet-origin box collider. The standing
box width must match `tuning.bodyWidth`. Add probes, then demand providers,
then the controller, then move producers, then the reconciler:

```ts yage-context=entity
import {
  installPlatformer,
  defaultPlatformerTuning,
} from "@yagejs-addons/character-controller/platformer";
const movement = installPlatformer(entity, {
  tuning: defaultPlatformerTuning(),
  collision: { solid: 0xffffffff, volume: 0xffffffff, wall: 0xffffffff },
});
const controller = movement.startController({
  demand: { direction: 1, down: false },
});
movement.finish();
```

The snippet assumes the body and collider already exist. `startController`
accepts `demand: PlatformerDemand` (direction, down, optional wallClingAllowed),
`limit?: { readonly speedScale: number }`, and
`fall?: { readonly holdingFall: boolean; readonly fallHoldRate: number }`.
Use getters for live policy. Errors in policy getters are attributed and rethrown.

Pass `admission: defaultPlatformerTuning()` in setup to mount MoveAdmission.
Read `movement.admission` after startController. Pass `terrain: false` to use
foot-strip sensing without slope/step assistance; `crush: true` adds CrushProbe.
Finish once during entity setup. All primitives can also be assembled directly.

## Shared motion ownership

Only MotionReconciler writes character velocity. Producers run before it in
component order and submit:

- `submit(intent)`: current step only.
- `submitOnce(intent)`: next advancing resolution, consumed even if refused.
- `submitDurable(intent)`: repeated until handle.end() or handle.cancel().

An intent has source, axis (`x`/`y`), target, acceleration, priority; optional
shed, frame (`world` default, `surface`, `launch`), terrain (`grounded`).
The optional `resolveMotion` function replaces arbitration while preserving the
component and queue. `MotionReconciler(terrain?, resolver?)` also accepts it.
Resolver errors are attributed and rethrown; returned velocities must be finite.
The default model follows these rules: highest priority wins each axis; equal winners throw. Acceleration/shed may
be Infinity for an immediate target. Other numeric inputs must be finite.
`refusedLastStep` names overridden sources.

Surface targets are relative to the moving support. Launch adds only upward
support motion; ground steering carries horizontal platform velocity into
flight. Use `motion.ownVelocityX` for animation and `velocityX/Y` for world travel.
Custom moves must opt into terrain correction with `terrain: "grounded"`.

Zero-time steps retain commands and holds without moving or consuming them.
Disabling the reconciler clears its queue. `yieldToSolver(velocity, gravityScale)`
clears requests and lets physics act; `reclaim(at?)` restores gravity and can
teleport with zero velocity. Cancel standard moves when your game interrupts
them. A higher-priority request overrides an axis but does not cancel another
producer's timers. No controller transient state is a save root; recreate the
character when restoring a saved spawn position.

## Terrain and events

`PlatformerLandedEvent`: landing after initial contact classification.
`PlatformerJumpedEvent`: `{ kind: "ground" | "air" | "wall" }`.
`PlatformerDashedEvent`: `{ direction: -1 | 1 }`.
`PlatformerSlidEvent`: slide burst.
`PlatformerCrushedEvent`: `{ surface, obstruction, direction }`.
No event applies damage, audio, particles or animation.

Ground/volume/wall are packed physics interaction groups, default all groups.
For one-way platforms, include them in solid and exclude them from volume and
wall. Sensors are excluded by physics queries. Keep the character out of query
groups used by crush geometry. Ledge clearance always excludes its own character. Use the existing ColliderComponent
`dropThrough` API for game-owned drop-through behavior.
Ground and terrain casts honor both colliders' contact filters, including
one-way/drop-through rules. Rejected surfaces do not count as landings or
restore air charges. Terrain assistance can leave a small clearance above a
surface; use `controller.grounded` and `PlatformerLandedEvent` for ground contact.

MovingSurface({ from, to, speed }) moves a kinematic platform between two world
points. Spawn moving surfaces before riders; planned velocity must be current
when riders sample support. Translating, upright surfaces are supported.
Freezing a surface with zero entity time scale stops its published carry velocity.
CrushProbe reports a translating box blocked by a fixed opposing face. Rotating
supports, angled crush wedges and two moving crush blockers are unsupported.

LedgeProbe exposes `find(side)`, `points(contact, dt?)`, `clear(from, to)` and
`clearStep(from, to, contact, dt)`. It measures flat ledges and full-body climb
clearance. Catch/hang/climb sequencing belongs to the game's movement producer;
the default helper supplies small-step assistance, not ledge hanging.
