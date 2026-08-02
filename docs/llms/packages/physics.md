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

Every `ColliderComponent` needs a sibling `RigidBodyComponent`, including a `sensor: true` one. For a trigger you move through its `Transform` (a bobbing pickup), use a `kinematic` body. Omitting the body throws when the collider is added, not at construction.

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
- `velocityX` / `velocityY` — scalar reads (px/s) that skip the `Vec2` allocation; reading both calls into Rapier twice
- `speed` / `speedSquared` — velocity magnitude (px/s) / squared magnitude, no `Vec2` allocation
- `applyImpulse(v: Vec2Like)` — instant momentum change
- `applyForce(v: Vec2Like)` — continuous force
- `position: Vec2` — read the simulated position (px), allocates a `Vec2`
- `positionX` / `positionY` — scalar reads (px) that skip the `Vec2` allocation; reading both calls into Rapier twice
- `rotation: number` — read the simulated rotation (radians)
- `setPosition(x, y)` — teleport any body type: no interpolation, the drawn pose jumps. Writing the `Transform` of a kinematic body instead moves it there smoothly over one step.
- `setRotation(radians)` — teleport rotation; the rotation counterpart of `setPosition`
- `setAngularVelocity(v)` / `getAngularVelocity()` — radians/s
- `applyTorque(t)` — rotational force
- `setEnabledTranslations(enableX, enableY)` — lock axes at runtime
- `lockRotations(locked)` — lock rotation at runtime
- `setGravityScale(scale)` / `gravityScale` — per-body gravity multiplier at runtime. `1` is scene gravity, `0` removes it, higher falls faster. Use it for variable jump height and fast-fall, where one body must fall differently from the rest. Callable before `entity.add()`; the value applies at body creation.

### Reading positions

A dynamic or kinematic body has two positions, and they differ within a frame:

- `entity.get(Transform).worldPosition` — the drawn pose. Blended between the last two fixed steps, so it moves smoothly at the display frame rate and is at most one fixed step behind the simulation. Use it for anything visual: camera follow, HUD markers, spawning effects at a body.
- `rb.position` / `rb.positionX` / `rb.positionY` / `rb.rotation` — the exact simulated pose, as of the last completed fixed step. Use it when a number must match the simulation: distance thresholds, snapping a body to a grid, saving a checkpoint.

Interpolation runs at the start of `Update`, so the `Transform` a component's `update(dt)` reads is the one that gets drawn that frame. Raycasts, collision events, and other physics queries always report exact poses — they run inside the simulation, not against the `Transform`.

### Moving kinematic bodies

Write the `Transform` (`setPosition`, `translate`) in `fixedUpdate`; the body reaches the written pose on the next physics step and is drawn interpolated, so the drawn gap to dynamic bodies riding it stays constant. A write from `update()` lands after that frame's interpolation pass: the frame shows the raw pose, then drawing re-blends from the last two steps, so a one-shot write visibly hops — prefer `fixedUpdate`. `rb.setPosition()` / `rb.setRotation()` teleport instead — no smoothing.

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

A `sensor: true` collider fires only `onTrigger`; a solid collider fires only `onCollision`. Register the wrong one and it never fires — dev builds log a warning when you add the handler.

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

Overlap queries report only pairs where this collider or the other is `sensor: true`; two solid colliders never report, however deeply they penetrate. For solid-vs-solid contact (contact damage, say) use `onCollision`.

```ts
collider.getOverlapping();                     // Entity[]
collider.getOverlapping({ tags: ["enemy"] });  // filtered
collider.getOverlappingComponents(Health);     // Component[]
```

Resizing:

```ts
collider.setShape({ type: "box", width: 20, height: 20 });   // crouch
collider.setShape({ type: "box", width: 20, height: 40 });   // stand back up
```

`setShape(shape, options?)` replaces the shape on the live Rapier collider. The handle, body attachment, and every `onCollision`/`onTrigger` subscription survive. Callable before `entity.add()`; the shape applies at collider creation.

The body keeps its mass. A collider is a collision proxy, not a measure of matter, so a crouching character takes the same `applyImpulse` knockback as a standing one. Pass `{ recomputeMass: true }` when the shape change means genuinely more or less matter and mass should come back from density × the new shape.

```ts
collider.setShape(small);                              // same mass
collider.setShape(big, { recomputeMass: true });        // heavier
```

Shrinking never pushes anything out of the way, and growing can leave the collider overlapping geometry it clears at the smaller size. Check clearance before growing back.

A collider is centred on its body's origin unless given an `offset`, so growing upward with the feet planted also moves the body up by half the gained height. Query the standing box where it will sit, not where the crouched one sits — querying at the crouched position reports the floor as a blocker whenever the character is grounded, so they can never stand.

```ts
const rise = (STAND_HEIGHT - CROUCH_HEIGHT) / 2;
const standing = { type: "box", width: 20, height: STAND_HEIGHT } as const;
const pos = transform.worldPosition;

const blocked = world.queryShape(
  standing,
  { x: pos.x, y: pos.y - rise },
  { excludeEntity: entity },
).length > 0;

if (!blocked) {
  collider.setShape(standing);
  rb.setPosition(pos.x, pos.y - rise);
}
```

Removing just the collider (`entity.remove(ColliderComponent)`) frees the Rapier collider and its internal lookup entries while the sibling body stays alive. Removing the whole entity, or the `RigidBodyComponent`, also removes every attached collider.

## One-Way Platforms

```ts
platform.add(new ColliderComponent({
  shape: { type: "box", width: 96, height: 8 },
  oneWay: {},                               // solid from above, passable from below
  // oneWay: {
  //   direction: { x: 0, y: -1 },          // solid-face direction, body-local; default up
  //   margin: 4,                           // px of overlap that still lands; default 4
  // }
}));

riderCollider.dropThrough(0.2);    // this body falls through one-way platforms for 0.2s
riderCollider.isDroppingThrough;   // boolean, true while the window is open
```

- A body lands on the face `direction` points at, passes through from every other side, and a body already inside the platform keeps passing until clear — it is never snapped to the surface.
- `dropThrough(seconds)` is per body: other bodies on the same platform stay supported. Seconds of simulated time (respects pause/timeScale). Wakes a sleeping body. Callable before `entity.add()`.
- `direction` is in the platform body's local frame and rotates with the body.
- A body that travels more than the platform-plus-body thickness in one step can cross the platform undetected; give it `ccd: true`. Rapier's CCD sweep honors one-way filtering, including drop-through.
- `oneWay` round-trips through save/load. No effect on `sensor: true` colliders (dev warning).

## Contact Filters

Decide per pair, per step, whether two colliders collide. `oneWay` is built on this; use it directly for rules `oneWay` can't express:

```ts
collider.setContactFilter((contact) => {
  contact.other;                                       // Entity on the other side
  contact.otherCollider;                               // its ColliderComponent
  contact.selfX; contact.selfY; contact.selfRotation;  // own collider, px / radians
  contact.otherX; contact.otherY; contact.otherRotation;
  contact.selfVelocityX; contact.otherVelocityY;       // body velocities, px/s
  contact.dt;                                          // current step, seconds
  return true;                                         // true = solid, false = pass through
});
collider.setContactFilter(null);   // remove
```

- Runs inside the physics step for every candidate pair involving the collider, every step. Keep it cheap; don't create or destroy entities, bodies, or colliders from inside it. The `contact` object is reused across calls — read, don't store.
- No contact normal or point exists yet. Positions/velocities are from the start of the step, so a body that crossed a surface mid-step still shows which side it came from.
- When both colliders in a pair have filters, the pair is solid only if both return `true`.
- A filter that throws is reported (`Inspector.getErrors().callbackErrors`) once per installed filter and the pair stays solid.
- `setContactFilter` replaces the built-in filter a `oneWay` config installed. Filters are functions and are not serialized: `oneWay` reinstalls its filter on load; custom filters must be re-registered after a restore.
- Contact pairs only — sensor/trigger pairs are unaffected.

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

// Raycast direction can be any non-zero vector (normalized internally,
// e.g. target.sub(origin) works). A zero-length direction throws.
const hit = world.raycast(origin, direction, maxDistance, { filterGroups });
// hit: { entity, point: Vec2, normal: Vec2, distance } | null

// Overlap queries — what a shape touches where it already stands
world.queryShape(shape, position, { rotation, filterGroups, excludeEntity }); // Entity[]
world.queryRadius(center, radius, { filterGroups, excludeEntity });           // Entity[]
world.queryOverlapping(colliderHandle);                                      // Entity[]

// Shape cast — sweep a shape along a direction and report the first hit.
// Same result shape as raycast: `distance` is how far the shape travelled,
// `point` the world contact point, `normal` the surface normal on the entity
// hit. A shape already overlapping something at `origin` reports distance 0.
// Direction is normalized internally; a zero-length direction throws.
const swept = world.castShape(shape, origin, direction, maxDistance, {
  rotation,
  filterGroups,
  excludeEntity,   // pass the mover when the sweep starts inside its own collider
});
```

Use `castShape` to test a move before committing to it: carrying a rider on a moving platform, spotting a closing platform before it traps the player, or checking clearance for a fast fall. `queryShape` only reports overlaps at a fixed position and misses anything the shape would pass through on the way.

## Serialization

Both `RigidBodyComponent` and `ColliderComponent` are `@serializable`. They implement `serialize()`, `fromSnapshot()`, and `afterRestore()` for save/load.
