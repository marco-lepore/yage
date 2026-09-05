# @yagejs-addons/steering

Steering (movement AI) for YAGE: seek, flee, arrive, wander, pursue/evade,
obstacle avoidance, flocking, path-following, and containment, blended into a
desired velocity. Root entry is pure `@yagejs/core`; the
`@yagejs-addons/steering/physics` entry adds a `RigidBodyComponent`-detecting
agent (optional `@yagejs/physics` peer). No `/presenters` subpath.

## Install

```bash
npm install @yagejs-addons/steering @yagejs/core
# only if you import @yagejs-addons/steering/physics:
npm install @yagejs/physics
```

Peers: `@yagejs/core` (required), `@yagejs/physics` (optional — the `/physics`
entry only).

## Zero-config kinematic chase

```ts
import { SteeringAgent, seek } from "@yagejs-addons/steering";
import { Transform } from "@yagejs/core";

enemy.add(
  new SteeringAgent({
    maxSpeed: 120,
    behaviors: [seek(() => player.get(Transform).position)],
  }),
);
```

`SteeringAgent` is a `@yagejs/core` Component; `ComponentFixedUpdateSystem`
drives `fixedUpdate(dt)`, so the agent steers once per fixed step (default
1/60 s). The default output integrates `transform.position` (local) — agents
are assumed root-level (local == world).

## Physics bodies

Mount-and-go (auto-detects the `RigidBodyComponent` sibling; impulse drive by
default, so the agent pushes crates, takes knockback, and gets deflected by
contacts while steering corrects at `maxAcceleration`). Add the body before
the agent — it reads the body's type when added:

```ts
import { PhysicsSteeringAgent } from "@yagejs-addons/steering/physics";

enemy.add(new RigidBodyComponent({ type: "dynamic", gravityScale: 0 }));
enemy.add(
  new ColliderComponent({ shape: { type: "circle", radius: 10 }, density: 1 }),
);
enemy.add(
  new PhysicsSteeringAgent({
    maxSpeed: 130,
    maxAcceleration: 500, // default 4x maxSpeed; the per-step impulse is the capped correction
    behaviors: [arrive(() => target, { slowRadius: 140 })],
  }),
);
```

On a kinematic body the agent switches automatically: kinematic bodies
ignore `setVelocity`/`applyImpulse`, so it writes the `Transform` instead —
the physics system takes that pose as the next step's target — and the agent
pushes dynamic bodies and is never pushed back. Passing `drive` with a
kinematic body throws; a static body throws at add.

Explicit `body` on the root class — structural, no physics import; also fits
custom movers implementing the two methods:

```ts
import { SteeringAgent, arrive } from "@yagejs-addons/steering";
import { RigidBodyComponent } from "@yagejs/physics";

enemy.add(
  new SteeringAgent({
    maxSpeed: 130,
    maxAcceleration: 500,
    behaviors: [arrive(() => target)],
    body: enemy.get(RigidBodyComponent), // read actual velocity + write output
    drive: "impulse", // needs applyImpulse + getMass on the body; omit for velocity drive
  }),
);
```

Drive modes:

- `"velocity"` (default) — writes the commanded velocity (`setVelocity`)
  every step. Full authority; external pushes decay at `maxAcceleration`
  (with a body the ramp starts from the actual velocity, so knockback is
  worked off, not overwritten). Dynamic bodies only: YAGE `kinematic`
  bodies are position-based and ignore `setVelocity`.
  `PhysicsSteeringAgent` handles them by Transform integration; with the
  base class, use no `body` — the default output integrates the Transform.
- `"impulse"` — per step applies `clamp(desired − actual, maxAcceleration·dt)
· getMass()` through `applyImpulse`, so external impulses compose with
  steering. Requires a body with `applyImpulse`/`getMass` (a dynamic
  `RigidBodyComponent`). Two-way physics: push and be pushed.

```ts
interface VelocityBody {
  setVelocity(v: Vec2Like): void;
  getVelocity(): Vec2Like;
}
interface ImpulseBody {
  applyImpulse(i: Vec2Like): void;
  getVelocity(): Vec2Like;
  getMass(): number;
}
```

With a `body`, behaviors and the ramp read `getVelocity()` — collisions and
knockback feed back into steering. Without one, the model runs on its own
commanded velocity.

## Clock

An enabled `SteeringAgent` skips a zero-time update before evaluating behaviors
or applying output. Velocity, heading, Transform, and physics body state remain
unchanged; this also covers custom `apply` callbacks and infinite acceleration.

`ComponentFixedUpdateSystem` drives `fixedUpdate(dt)`, so the agent steers
once per fixed step. Steering output is simulation input, and physics runs on
the same clock.

`PhysicsSystem` steps the world in `Phase.FixedUpdate` at priority 0 and
writes each dynamic body's end-of-step pose to `Transform`;
`ComponentFixedUpdateSystem` runs in the same phase at priority 1000, so an
agent reads simulated poses. A kinematic body gets the same write, skipped
when the game has moved that `Transform` since the last step — the pose the
game wrote is the body's next step target. The previous/current blend
`PhysicsInterpolationSystem` writes in `Phase.Update` at priority -100 is the
pose the frame draws, which the simulation never occupied. Which pose the
agent reads affects `arrive` radii, `followPath`'s `waypointRadius`, the
`separation`/`alignment`/`cohesion` ranges, and the origin of the
`avoidColliders` raycast. Under a scene time scale below 1 the physics system
steps less often than the fixed clock ticks, and on a tick with no step the
`Transform` still holds the blend the last frame drew.

Nothing in the engine interpolates a `Transform` that no rigid body drives,
so a bodyless agent's drawn position changes once per fixed step; above 60 Hz
it changes less often than the screen redraws. One way to draw on the frame
clock is to take the commanded velocity from `apply` and integrate it
yourself:

```ts
let commanded = Vec2.ZERO;
enemy.add(
  new SteeringAgent({
    maxSpeed: 120,
    behaviors: [seek(() => target)],
    apply: (velocity) => {
      commanded = velocity;
    },
  }),
);
// in a component's own update(dt):
enemy.get(Transform).translate(commanded.x * dt, commanded.y * dt);
```

`enabled = false` stops the `apply` callback, so `commanded` keeps its last
value and the integration above keeps moving the entity. `agent.stop()`
pushes a zero through `apply`.

## `Steering` (headless model, L1)

`new Steering(behaviors?: SteeringBehavior[])`. `add(b): this`,
`remove(b): this`, `clear(): this`,
`compute(agent: AgentState, dt: number): Vec2` — arbitrates by `priority`
tier (highest first; the first tier whose weighted sum is non-zero wins,
clamped to `agent.maxSpeed`; lower tiers are not evaluated in that call).
Within a tier, contributions sum scaled by `weight`. All behaviors on the
default priority 0 = plain weighted sum. Zero behaviors, or all ZERO, →
ZERO.

```ts
interface AgentState {
  readonly position: Vec2;
  readonly velocity: Vec2;
  readonly maxSpeed: number;
  readonly entity?: Entity;
}
interface SteeringBehavior {
  readonly weight: number;
  readonly priority: number;
  evaluate(agent: AgentState, dt: number): Vec2;
}
```

## `SteeringAgent` (L2a Component)

```ts
interface SteeringAgentOptions {
  maxSpeed: number; // required, px/s, settable live
  behaviors?: SteeringBehavior[];
  maxAcceleration?: number; // px/s²; default 4 x maxSpeed (top speed in 0.25s); Infinity = instant snap
  body?: VelocityBody | ImpulseBody; // structural; RigidBodyComponent satisfies both
  drive?: "velocity" | "impulse"; // default "velocity"
  apply?: (velocity: Vec2, ctx: SteeringApplyContext) => void; // bodyless custom output; exclusive with body
  faceHeading?: boolean; // default false; rotates Transform to travel direction (>1 px/s)
  enabled?: boolean; // default true
}
interface SteeringApplyContext {
  readonly entity: Entity;
  readonly dt: number;
  readonly transform: Transform;
}
```

Per step (`fixedUpdate(dt)`): skip if `!enabled` → `current` = body's
`getVelocity()` if a body is set, else last commanded → `desired =
steering.compute({ position, velocity: current, maxSpeed }, dt)` → velocity
drive: `velocity = moveTowards(current, desired, maxAcceleration·dt)`,
written to the body or `apply`; impulse drive:
`applyImpulse(clamp(desired − current, maxAcceleration·dt) · getMass())` →
`faceHeading` && speed > 1 px/s: `transform.setRotation(velocity.angle())`.
On a dynamic body the simulated rotation owns the `Transform`, and
`PhysicsInterpolationSystem` overwrites the heading before the frame draws.
Pass `syncRotation: false` on the `RigidBodyComponent` to give the agent
rotation.

Live surface: `agent.steering` (mutate live), `agent.velocity` (commanded /
expected-after-impulse, getter — the body's `getVelocity()` is ground truth),
`agent.maxSpeed` (settable), `agent.setBehaviors(b)`, `agent.stop()` (zeroes
bookkeeping and pushes a zero through the output: `setVelocity(0)`, a
counter-impulse, or `apply(ZERO)`), inherited `agent.enabled`.

## Targets, obstacles, neighbors — static or live

```ts
type PointTarget = Vec2Like | ((agent: AgentState) => Vec2Like);
type KinematicTarget = Kinematic | ((agent: AgentState) => Kinematic); // { position, velocity }
type ObstaclesSource =
  | readonly Obstacle[]
  | ((agent: AgentState) => readonly Obstacle[]); // { position, radius }
type NeighborsSource =
  | readonly Kinematic[]
  | ((agent: AgentState) => readonly Kinematic[]);
```

Resolved fresh every `compute` call. Providers receive the agent's state —
ignore it for a plain moving target, use it for agent-relative sources.
`AgentState.entity` is set when a `SteeringAgent` hosts the model (used by
physics queries to exclude the agent itself).

## Behaviors

Every factory returns `SteeringBehavior`; every options type extends
`{ weight?: number; priority?: number }` (defaults 1 and 0). `weight` is the
volume within a tier; `priority` raises a behavior to an overriding tier —
`avoidObstacles(rocks, { priority: 1 })` overrides seek outright whenever it
returns a non-zero steer.

- `seek(target: PointTarget, opts?: SeekOptions)` — `normalize(target - pos) * maxSpeed`. ZERO at the target.
- `flee(target: PointTarget, opts?: FleeOptions)` — `{ radius? }`. `normalize(pos - target) * maxSpeed`. `radius` set: ZERO when `distance > radius`. ZERO at the target.
- `arrive(target: PointTarget, opts?: ArriveOptions)` — `{ slowRadius = 120, arriveRadius = 4, onArrive?, onDepart? }`. Full speed outside `slowRadius`; `speed = maxSpeed * (d / slowRadius)` inside it; ZERO inside `arriveRadius`. `onArrive`/`onDepart` fire once per crossing.
- `wander(opts?: WanderOptions)` — `{ distance = 60, radius = 30, jitter = 3, random = globalRandom.float }`. Pass a scene-scoped random source when wander must replay with the scene. Wander angle nudges by `(random()*2-1) * jitter * dt` rad/s; circle sits at `pos + heading * distance` (`heading` = `normalize(velocity)`, falls back to last heading then `Vec2.RIGHT` when stationary); target = `circleCenter + fromAngle(angle) * radius`.
- `pursue(target: KinematicTarget, opts?: PursueOptions)` — `{ maxPrediction = 1 }`. Leads `target.position + target.velocity * min(maxPrediction, distance / maxSpeed)`. Stationary target ≈ `seek`.
- `evade(target: KinematicTarget, opts?: PursueOptions)` — same prediction, then flees it. Stationary target ≈ `flee`.
- `avoidObstacles(obstacles: ObstaclesSource, opts?: AvoidObstaclesOptions)` — `{ lookAhead = 100, agentRadius = 0 }`. Casts a ray of length `lookAhead` along `normalize(velocity)`; among obstacles whose `radius + agentRadius` crosses it, steers laterally away from the one closest to the agent. ZERO when stationary or nothing's in the path. High `weight` (2–3) typical so avoidance dominates the sum.
- `separation(neighbors: NeighborsSource, opts?: FlockOptions)` — `{ radius = 40 }`. Inverse-distance-weighted push away from every neighbor in range. ZERO with none in range; symmetric neighbors cancel.
- `alignment(neighbors: NeighborsSource, opts?: FlockOptions)` — `{ radius = 80 }`. `normalize(mean(neighbor.velocity in range)) * maxSpeed`. ZERO with none in range.
- `cohesion(neighbors: NeighborsSource, opts?: FlockOptions)` — `{ radius = 80 }`. Seeks the centre of mass of neighbors in range. ZERO with none in range.
- `followPath(waypoints: readonly Vec2Like[], opts?: FollowPathOptions): FollowPathBehavior` — `{ waypointRadius = 16, loop = false, slowRadius = 120, arriveRadius = 4, startAt = 0, onArrive?, onDepart? }`. Full speed toward the current waypoint, advancing within `waypointRadius`; `loop` wraps forever, otherwise the final waypoint gets `arrive` semantics. Takes plain points — pathfinding's `Path.waypoints` feeds it directly. Progress lives in the behavior: swap in a new `followPath` for a new path; for save/restore, snapshot the returned behavior's `waypointIndex` and pass it back as `startAt` (or use `startAt: "nearest"` for mid-route attach). ZERO for an empty list.
- `contain(bounds: ContainBounds, opts?: ContainOptions)` — `bounds = { x, y, width, height }`, `{ lookAhead = 60 }`. When `pos + heading·lookAhead` leaves the bounds, steers inward at full strength on violated axes, keeping the heading on the rest (banks along the edge). ZERO while safely inside.

`/physics` entry additions (value-import physics; optional peer):

- `avoidColliders(world: PhysicsWorld | (agent) => PhysicsWorld, opts?)` — `{ lookAhead = 100, whiskerAngle = π/6, whiskerLength = 0.7·lookAhead }` (+ weight/priority). Raycasts the real world along the heading (center ray + two whiskers; `whiskerLength: 0` disables); steers away from the closest hit along the hit normal's lateral component (perpendicular tie-break on a dead-center wall hit). Excludes the agent's own collider via `AgentState.entity`. ZERO when stationary or clear. Pair with `priority: 1`.
- `physicsNeighbors(world, opts?)` — `{ radius = 80, filterGroups? }`. A `NeighborsSource` over `PhysicsWorld.queryRadius` around the agent: entities with a collider in range become Kinematics (no body = stationary), agent excluded. Note: each flock rule resolves the source in every `compute` call — three rules = three queries.

## Headless / manual drive

```ts
import { Steering, seek } from "@yagejs-addons/steering";
const steering = new Steering([seek(() => target)]);
let pos = new Vec2(0, 0);
let vel = Vec2.ZERO;
vel = steering.compute({ position: pos, velocity: vel, maxSpeed: 120 }, dt);
pos = pos.add(vel.scale(dt));
```

## Not in v1

Bundled debug presenter — draw `agent.velocity` yourself. By design (not
deferred): arrival is a callback (`onArrive` — mirror to your own event in a
line), and there is no snapshot/restore (steering state is transient;
`followPath` progress saves via `waypointIndex`/`startAt`).
