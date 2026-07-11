# @yagejs-addons/behaviors

Steering (movement AI) for YAGE (`@yagejs-addons` scope, independently
versioned, NOT in the engine `fixed` group). A headless weighted-sum blend
model plus a `@yagejs/core` Component host — pure `@yagejs/core`, no pixi, no
physics, no input.

## Install

```bash
npm install @yagejs-addons/behaviors
npm install @yagejs/core # engine peer (single install, reused — not bundled)
```

`@yagejs/core` is the only peer. No runtime deps.

## One entry point

Unlike the other addons here, `behaviors` has no `/presenters` subpath —
steering has no view to swap, only a velocity to compute:

```ts
import { SteeringAgent, seek, flee, arrive, wander, pursue, evade, avoidObstacles, separation, alignment, cohesion, Steering } from "@yagejs-addons/behaviors";
```

## 5-minute setup

```ts
import { SteeringAgent, seek } from "@yagejs-addons/behaviors";
import { Transform } from "@yagejs/core";

// enemy is an Entity with a Transform. The default apply integrates it:
// position += velocity * dt. Nothing else to wire.
enemy.add(
  new SteeringAgent({
    maxSpeed: 120,
    behaviors: [seek(() => player.get(Transform).position)],
  }),
);
```

Physics body — the game owns the apply, the addon stays physics-free:

```ts
import { RigidBodyComponent } from "@yagejs/physics";

const body = enemy.get(RigidBodyComponent);
enemy.add(
  new SteeringAgent({
    maxSpeed: 120,
    maxAcceleration: 600, // px/s² turn-rate cap; omit = velocity snaps to desired
    behaviors: [arrive(() => waypoint, { slowRadius: 140 })],
    apply: (v) => body.setVelocity(v), // one line; addon never imports physics
  }),
);
```

See [the full docs](https://yage.dev/addons/behaviors/) for blending, obstacle
avoidance, flocking, and the headless/manual-drive API.

## Live escape hatches

```ts
agent.steering.add(flee(() => boss.position, { weight: 4 })); // add behavior live
agent.maxSpeed = 200; // retune
agent.velocity; // Vec2, last commanded — for a debug arrow
agent.stop(); // zero the velocity now
agent.enabled = false; // pause ticking without removing the component
```

## Not in v1

Path-following, priority-arbitration blending, steering-force output,
physics-backed obstacle/neighbor discovery, and a bundled debug presenter are
deferred. See the [behaviors doc](https://yage.dev/addons/behaviors/) for
details.
