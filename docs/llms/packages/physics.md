# @yagejs/physics

Depends on `@yagejs/core`. Rapier2D physics with pixel-based API. All values in pixels.

## Setup

```ts
import { PhysicsPlugin } from "@yagejs/physics";

engine.use(new PhysicsPlugin({
  gravity: { x: 0, y: 980 },   // px/s², default (0, 980)
  pixelsPerMeter: 50,           // default 50
}));
```

## Bundler Setup

`@yagejs/physics` depends on `@dimforge/rapier2d`, which ships a `.wasm` file. With Vite, add `vite-plugin-wasm` to load it:

```ts
// vite.config.ts
import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  plugins: [wasm()],
});
```

That's all that's required for `@yagejs/physics`. See `examples/vite.config.ts` for the canonical reference config. If you also use `@yagejs/save`, check its Bundler Setup section for two additional oxc/minify options.

## Component Ordering

`Transform` → `RigidBodyComponent` → `ColliderComponent` (required order).

## RigidBodyComponent

```ts
import { RigidBodyComponent } from "@yagejs/physics";

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
- `getVelocity(): Vec2` — read velocity (px/s), allocates a `Vec2`
- `velocityX` / `velocityY` — allocation-free scalar reads (px/s); reading both calls into Rapier twice
- `speed` / `speedSquared` — allocation-free velocity magnitude (px/s) / squared magnitude
- `applyImpulse(v: Vec2Like)` — instant momentum change
- `applyForce(v: Vec2Like)` — continuous force
- `setPosition(x, y)` — teleport a dynamic body (skips interpolation). For kinematic bodies, use `transform.setPosition()` instead — the physics system syncs Transform → Rapier automatically each frame.
- `setAngularVelocity(v)` / `getAngularVelocity()` — radians/s
- `applyTorque(t)` — rotational force
- `setEnabledTranslations(enableX, enableY)` — lock axes at runtime
- `lockRotations(locked)` — lock rotation at runtime

## ColliderComponent

```ts
import { ColliderComponent } from "@yagejs/physics";

entity.add(new ColliderComponent({
  shape: { type: "box", width: 64, height: 32 },
  // shape: { type: "circle", radius: 16 },
  // shape: { type: "capsule", halfHeight: 20, radius: 10, axis: "y" },   // axis defaults to "y" (vertical); "x" rotates 90°
  // shape: { type: "polygon", vertices: [{x,y}, ...] },                  // closed convex; concave input is silently widened by Rapier (dev warning logged)
  // shape: { type: "polyline", vertices: [{x,y}, ...] },                 // chain of segments; supports non-convex; static-only (no inertia)
  restitution: 0.5,
  friction: 0.3,
  density: 1,
  sensor: false,       // true = trigger (no physical response)
  offset: { x: 0, y: 0 },
  rotation: 0,         // radians, relative to the body, about the offset point (axis:"x" capsules: adds to the 90° axis rotation)
  layers: LAYER_PLAYER,  // bitmask
  mask: LAYER_WALL,      // which layers to interact with
}));
```

Events:
```ts
collider.onTrigger((ev) => { ev.other; ev.entered; });       // sensor events
collider.onCollision((ev) => {
  ev.other; ev.started;
  // contactNormal/contactPoint/penetrationDepth: only on started, non-sensor
  // collisions, and may be absent if no contact manifold is available.
  ev.contactNormal;      // Vec2, unit, points from this entity toward `other`
  ev.contactPoint;       // Vec2, world pixels, a representative point (not an average)
  ev.penetrationDepth;   // number, world pixels, >= 0
});
// Both return unsubscribe function
```

Knockback example:
```ts
collider.onCollision((ev) => {
  if (!ev.started || !ev.contactNormal) return;
  const knockback = ev.contactNormal.scale(-300); // push this entity away from `other`
  entity.get(RigidBodyComponent).setVelocity(knockback);
});
```

Overlap queries:
```ts
collider.getOverlapping();                    // Entity[]
collider.getOverlapping({ has: [EnemyTag] }); // filtered
collider.getOverlappingComponents(Health);    // Component[]
```

Removing just the collider (`entity.remove(ColliderComponent)`) frees the Rapier collider and its internal lookup entries while the sibling body stays alive. Removing the whole entity, or the `RigidBodyComponent`, also removes every attached collider.

## CollisionLayers

```ts
import { CollisionLayers } from "@yagejs/physics";

const layers = new CollisionLayers();
const PLAYER = layers.define("player");   // bitmask value
const WALL = layers.define("wall");
// Use as: layers: PLAYER, mask: WALL | COIN
// Static helper: CollisionLayers.interactionGroups(membership, filter)
```

## PhysicsWorld

```ts
import { PhysicsWorldKey } from "@yagejs/physics";

// Scene-scoped key: the physics plugin's `beforeEnter` hook registers
// the active scene's `PhysicsWorld` on its scope. Use `PhysicsWorldManagerKey`
// (engine-scope) only for cross-scene enumeration.
const world = this.use(PhysicsWorldKey);

// Gravity
world.setGravity(0, -980);

// Raycast — direction can be any non-zero vector (normalized internally,
// e.g. target.sub(origin) works); a zero-length direction throws.
const hit = world.raycast(origin, direction, maxDistance, { filterGroups });
// hit: { entity, point: Vec2, normal: Vec2, distance } | null

// Overlap query
world.queryOverlapping(colliderHandle); // Entity[]
```

## Serialization

Both `RigidBodyComponent` and `ColliderComponent` are `@serializable`. They implement `serialize()`, `fromSnapshot()`, and `afterRestore()` for save/load.
