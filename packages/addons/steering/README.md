# @yagejs-addons/steering

Steering (movement AI) for YAGE (`@yagejs-addons` scope, independently
versioned, NOT in the engine `fixed` group). A headless weighted-sum blend
model plus a `@yagejs/core` Component host. The root entry is pure
`@yagejs/core`; `@yagejs-addons/steering/physics` adds a
`RigidBodyComponent`-detecting agent.

## Install

```bash
npm install @yagejs-addons/steering
npm install @yagejs/core # engine peer (single install, reused — not bundled)
npm install @yagejs/physics # only if you import @yagejs-addons/steering/physics
```

Peers: `@yagejs/core` (required), `@yagejs/physics` (optional — the
`/physics` entry only). No runtime deps.

## Entry points

No `/presenters` subpath — steering has no view to swap, only a velocity to
compute. The `/physics` entry exists so the root stays physics-free:

```ts
import { SteeringAgent, seek, flee, arrive, wander, pursue, evade, avoidObstacles, separation, alignment, cohesion, followPath, contain, Steering } from "@yagejs-addons/steering";
import { avoidColliders, physicsNeighbors, PhysicsSteeringAgent } from "@yagejs-addons/steering/physics";
```

## 5-minute setup

```ts
import { SteeringAgent, seek } from "@yagejs-addons/steering";
import { Transform } from "@yagejs/core";

// enemy is an Entity with a Transform. The default output integrates it:
// position += velocity * dt. Nothing else to wire.
enemy.add(
  new SteeringAgent({
    maxSpeed: 120,
    behaviors: [seek(() => player.get(Transform).position)],
  }),
);
```

Physics body — mount `PhysicsSteeringAgent` next to a `RigidBodyComponent`
and it drives it. Impulse drive (the default) means real two-way physics:
the agent pushes crates, takes knockback, and steering pulls it back on
course at `maxAcceleration`:

```ts
import { PhysicsSteeringAgent } from "@yagejs-addons/steering/physics";

enemy.add(
  new PhysicsSteeringAgent({
    maxSpeed: 130,
    maxAcceleration: 500, // required: the per-frame impulse is the capped correction
    behaviors: [arrive(() => waypoint, { slowRadius: 140 })],
  }),
);
```

Or use the structural `body` option on the root class — the addon's root
entry never imports physics; `{ setVelocity, getVelocity }` is satisfied by
`RigidBodyComponent` as-is, and by any custom mover object:

```ts
enemy.add(
  new SteeringAgent({
    maxSpeed: 130,
    maxAcceleration: 500,
    behaviors: [arrive(() => waypoint)],
    body: enemy.get(RigidBodyComponent),
  }),
);
```

See [the full docs](https://yage.dev/addons/steering/) for blending, obstacle
avoidance, flocking, path-following, containment, drive modes, and the
headless/manual-drive API.

## Live escape hatches

```ts
agent.steering.add(flee(() => boss.position, { weight: 4 })); // add behavior live
agent.maxSpeed = 200; // retune
agent.velocity; // Vec2 the agent is steering toward — for a debug arrow
agent.stop(); // halt now: zeroes the model AND the body/output
agent.enabled = false; // pause ticking without removing the component
```

## Not in v1

A bundled debug presenter is deferred — read `agent.velocity` and draw the
arrow yourself. See the [steering doc](https://yage.dev/addons/steering/)
for details.
