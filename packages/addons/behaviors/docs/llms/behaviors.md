# @yagejs-addons/behaviors

Steering (movement AI) for YAGE: seek, flee, arrive, wander, pursue/evade,
obstacle avoidance, and flocking, blended into a desired velocity. Pure
`@yagejs/core` — no pixi, no physics, no input. One entry point, no
`/presenters` subpath.

## Install

```bash
npm install @yagejs-addons/behaviors @yagejs/core
```

Peer: `@yagejs/core` only.

## Zero-config kinematic chase

```ts
import { SteeringAgent, seek } from "@yagejs-addons/behaviors";
import { Transform } from "@yagejs/core";

enemy.add(
  new SteeringAgent({
    maxSpeed: 120,
    behaviors: [seek(() => player.get(Transform).position)],
  }),
);
```

`SteeringAgent` is a `@yagejs/core` Component; `ComponentUpdateSystem` drives
`update(dt)`. Default `apply` integrates `transform.position` (local) —
agents are assumed root-level (local == world).

## Physics body

```ts
import { RigidBodyComponent } from "@yagejs/physics";
const body = enemy.get(RigidBodyComponent);
enemy.add(
  new SteeringAgent({
    maxSpeed: 120,
    maxAcceleration: 600, // px/s²; omit = velocity snaps to desired
    behaviors: [arrive(() => waypoint, { slowRadius: 140 })],
    apply: (v) => body.setVelocity(v), // addon never imports @yagejs/physics
  }),
);
```

## `Steering` (headless model, L1)

`new Steering(behaviors?: SteeringBehavior[])`. `add(b): this`,
`remove(b): this`, `clear(): this`,
`compute(agent: AgentState, dt: number): Vec2` — sums every behavior's
`evaluate(agent, dt) * behavior.weight`, clamps to `agent.maxSpeed`. Zero
behaviors, or all ZERO, → ZERO.

```ts
interface AgentState { readonly position: Vec2; readonly velocity: Vec2; readonly maxSpeed: number; }
interface SteeringBehavior { readonly weight: number; evaluate(agent: AgentState, dt: number): Vec2; }
```

## `SteeringAgent` (L2a Component)

```ts
interface SteeringAgentOptions {
  maxSpeed: number;                 // required, px/s, settable live
  behaviors?: SteeringBehavior[];
  maxAcceleration?: number;         // px/s²; omit = instant velocity change
  apply?: (velocity: Vec2, ctx: SteeringApplyContext) => void; // default = kinematic Transform integration
  faceHeading?: boolean;            // default false; rotates Transform to travel direction
  enabled?: boolean;                // default true
}
interface SteeringApplyContext { readonly entity: Entity; readonly dt: number; readonly transform: Transform; }
```

Per-frame (`update(dt)`): skip if `!enabled` → build `AgentState` from
`transform.position` + last commanded velocity → `desired =
steering.compute(state, dt)` → `maxAcceleration` set:
`velocity = Vec2.moveTowards(velocity, desired, maxAcceleration * dt)`,
else `velocity = desired` → `apply(velocity, ctx)` → `faceHeading` &&
velocity non-negligible: `transform.setRotation(velocity.angle())`.

Live surface: `agent.steering` (mutate live), `agent.velocity` (last
commanded, getter), `agent.maxSpeed` (settable), `agent.setBehaviors(b)`,
`agent.stop()` (zeroes velocity), inherited `agent.enabled`.

## Targets, obstacles, neighbors — static or live

```ts
type PointTarget = Vec2Like | (() => Vec2Like);
type KinematicTarget = Kinematic | (() => Kinematic);           // { position, velocity }
type ObstaclesSource = readonly Obstacle[] | (() => readonly Obstacle[]); // { position, radius }
type NeighborsSource = readonly Kinematic[] | (() => readonly Kinematic[]);
```

Resolved fresh every `compute` call — a `() =>` provider tracks a moving
source with no re-wiring.

## Behaviors

Every factory returns `SteeringBehavior`; every options type extends
`{ weight?: number }` (default 1).

- `seek(target: PointTarget, opts?: SeekOptions)` — `normalize(target - pos) * maxSpeed`. ZERO at the target.
- `flee(target: PointTarget, opts?: FleeOptions)` — `{ radius? }`. `normalize(pos - target) * maxSpeed`. `radius` set: ZERO when `distance > radius`. ZERO at the target.
- `arrive(target: PointTarget, opts?: ArriveOptions)` — `{ slowRadius = 120, arriveRadius = 4, onArrive?, onDepart? }`. Full speed outside `slowRadius`; `speed = maxSpeed * (d / slowRadius)` inside it; ZERO inside `arriveRadius`. `onArrive`/`onDepart` fire once per crossing.
- `wander(opts?: WanderOptions)` — `{ distance = 60, radius = 30, jitter = 3, random = Math.random }`. Wander angle nudges by `(random()*2-1) * jitter * dt` rad/s; circle sits at `pos + heading * distance` (`heading` = `normalize(velocity)`, falls back to last heading then `Vec2.RIGHT` when stationary); target = `circleCenter + fromAngle(angle) * radius`.
- `pursue(target: KinematicTarget, opts?: PursueOptions)` — `{ maxPrediction = 1 }`. Leads `target.position + target.velocity * min(maxPrediction, distance / maxSpeed)`. Stationary target ≈ `seek`.
- `evade(target: KinematicTarget, opts?: PursueOptions)` — same prediction, then flees it. Stationary target ≈ `flee`.
- `avoidObstacles(obstacles: ObstaclesSource, opts?: AvoidObstaclesOptions)` — `{ lookAhead = 100, agentRadius = 0 }`. Casts a ray of length `lookAhead` along `normalize(velocity)`; among obstacles whose `radius + agentRadius` crosses it, steers laterally away from the one closest to the agent. ZERO when stationary or nothing's in the path. High `weight` (2–3) typical so avoidance dominates the sum.
- `separation(neighbors: NeighborsSource, opts?: FlockOptions)` — `{ radius = 40 }`. Inverse-distance-weighted push away from every neighbor in range. ZERO with none in range; symmetric neighbors cancel.
- `alignment(neighbors: NeighborsSource, opts?: FlockOptions)` — `{ radius = 80 }`. `normalize(mean(neighbor.velocity in range)) * maxSpeed`. ZERO with none in range.
- `cohesion(neighbors: NeighborsSource, opts?: FlockOptions)` — `{ radius = 80 }`. Seeks the centre of mass of neighbors in range. ZERO with none in range.

## Headless / manual drive

```ts
import { Steering, seek } from "@yagejs-addons/behaviors";
const steering = new Steering([seek(() => target)]);
let pos = new Vec2(0, 0);
let vel = Vec2.ZERO;
vel = steering.compute({ position: pos, velocity: vel, maxSpeed: 120 }, dt);
pos = pos.add(vel.scale(dt));
```

## Not in v1

`followPath(waypoints: readonly Vec2Like[])` (path-following — will consume a
plain `Vec2[]`, no `@yagejs/pathfinding` dependency), priority-arbitration
blend, steering-force output, physics-backed obstacle/neighbor discovery,
`SteeringArrivedEvent` entity/bus mirror, snapshot/restore (steering state is
transient and re-derives — no `SnapshotContributor`), debug presenter.
