# @yage/physics

Depends on `@yage/core`. Rapier2D physics with pixel-based API. All values in pixels.

## Setup

```ts
import { PhysicsPlugin } from "@yage/physics";

engine.use(new PhysicsPlugin({
  gravity: { x: 0, y: 980 },   // px/s², default (0, 980)
  pixelsPerMeter: 50,           // default 50
}));
```

## Bundler Setup

`@yage/physics` depends on `@dimforge/rapier2d`, which ships a `.wasm` file. With Vite, add `vite-plugin-wasm` to load it:

```ts
// vite.config.ts
import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  plugins: [wasm()],
});
```

That's all that's required for `@yage/physics`. See `examples/vite.config.ts` for the canonical reference config. If you also use `@yage/save`, check its Bundler Setup section for two additional oxc/minify options.

## Component Ordering

`Transform` → `RigidBodyComponent` → `ColliderComponent` (required order).

## RigidBodyComponent

```ts
import { RigidBodyComponent } from "@yage/physics";

entity.add(new RigidBodyComponent({
  type: "dynamic",          // "dynamic" | "static" | "kinematic"
  fixedRotation: true,
  gravityScale: 0,          // 0 = no gravity
  linearDamping: 5,
  angularDamping: 1,
  ccd: true,                // continuous collision detection
  lockTranslationX: false,
  syncRotation: true,       // sync rotation to Transform (default true)
}));
```

Methods:
- `setVelocity(v: Vec2Like)` — set linear velocity (px/s). Preferred over impulse.
- `setVelocityX(vx)` / `setVelocityY(vy)` — set single axis
- `getVelocity(): Vec2` — read velocity (px/s)
- `applyImpulse(v: Vec2Like)` — instant momentum change
- `applyForce(v: Vec2Like)` — continuous force
- `setPosition(x, y)` — teleport a dynamic body (skips interpolation). For kinematic bodies, use `transform.setPosition()` instead — the physics system syncs Transform → Rapier automatically each frame.
- `setAngularVelocity(v)` / `getAngularVelocity()` — radians/s
- `applyTorque(t)` — rotational force
- `setEnabledTranslations(enableX, enableY)` — lock axes at runtime
- `lockRotations(locked)` — lock rotation at runtime

## ColliderComponent

```ts
import { ColliderComponent } from "@yage/physics";

entity.add(new ColliderComponent({
  shape: { type: "box", width: 64, height: 32 },
  // shape: { type: "circle", radius: 16 },
  // shape: { type: "capsule", halfHeight: 20, radius: 10 },
  // shape: { type: "polygon", vertices: [{x,y}, ...] },
  restitution: 0.5,
  friction: 0.3,
  density: 1,
  sensor: false,       // true = trigger (no physical response)
  offset: { x: 0, y: 0 },
  layers: LAYER_PLAYER,  // bitmask
  mask: LAYER_WALL,      // which layers to interact with
}));
```

Events:
```ts
collider.onTrigger((ev) => { ev.other; ev.entered; });       // sensor events
collider.onCollision((ev) => { ev.other; ev.started; ev.contactNormal; ev.contactPoint; });
// Both return unsubscribe function
```

Overlap queries:
```ts
collider.getOverlapping();                    // Entity[]
collider.getOverlapping({ has: [EnemyTag] }); // filtered
collider.getOverlappingComponents(Health);    // Component[]
```

## CollisionLayers

```ts
import { CollisionLayers } from "@yage/physics";

const layers = new CollisionLayers();
const PLAYER = layers.define("player");   // bitmask value
const WALL = layers.define("wall");
// Use as: layers: PLAYER, mask: WALL | COIN
// Static helper: CollisionLayers.interactionGroups(membership, filter)
```

## PhysicsWorld

```ts
import { PhysicsWorldManagerKey } from "@yage/physics";

const world = this.use(PhysicsWorldManagerKey).getOrCreateWorld(this.scene);

// Gravity
world.setGravity(0, -980);

// Raycast
const hit = world.raycast(origin, direction, maxDistance, { filterGroups });
// hit: { entity, point: Vec2, normal: Vec2, distance } | null

// Overlap query
world.queryOverlapping(colliderHandle); // Entity[]
```

## Serialization

Both `RigidBodyComponent` and `ColliderComponent` are `@serializable`. They implement `serialize()`, `fromSnapshot()`, and `afterRestore()` for save/load.
