# @yagejs/physics

Depends on `@yagejs/core`. Rapier2D physics with pixel-based API. All values in pixels.

## Setup

```ts
import { PhysicsPlugin } from "@yagejs/physics";

engine.use(
  new PhysicsPlugin({
    gravity: { x: 0, y: 980 }, // px/s², default (0, 980); both finite
    pixelsPerMeter: 50, // default 50; finite and > 0
  }),
);
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

That's all that's required for `@yagejs/physics`. See `examples/vite.config.ts` for the canonical reference config.

## Component Ordering

`Transform` → `RigidBodyComponent` → `ColliderComponent` (required order).

Every `ColliderComponent` needs a sibling `RigidBodyComponent`, including a `sensor: true` one. For a trigger you move through its `Transform` (a bobbing pickup), use a `kinematic` body. Omitting the body throws when the collider is added, not at construction.

## RigidBodyComponent

```ts
import { RigidBodyComponent } from "@yagejs/physics";

entity.add(
  new RigidBodyComponent({
    type: "dynamic", // "dynamic" | "static" | "kinematic"
    fixedRotation: true,
    gravityScale: 0, // 0 = no gravity; finite (negative floats the body up)
    linearDamping: 5, // finite and >= 0
    angularDamping: 1, // finite and >= 0
    ccd: true, // continuous collision detection
    lockTranslationX: false,
    syncRotation: true, // sync rotation to Transform (default true)
  }),
);
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
- `setPosition(x, y)` — teleport any body type: no interpolation, the drawn pose jumps. A static body's `Transform` moves with it. Writing the `Transform` of a kinematic body instead moves it there smoothly over one step.
- `setRotation(radians)` — teleport rotation; the rotation counterpart of `setPosition`, and it rotates a static body's `Transform` too when `syncRotation` is on
- `setAngularVelocity(v)` / `getAngularVelocity()` — radians/s
- `applyTorque(t)` — rotational force, in Rapier's native units: the value is not converted from pixels, and angular inertia scales with `pixelsPerMeter`⁻⁴, so the same torque spins a body 16× faster at 100 px/m than at 50. Retune after changing the scale, as with spring stiffness.
- `setEnabledTranslations(enableX, enableY)` — lock or unlock translation axes. A locked axis ignores forces, impulses and contacts; `setVelocity` still moves the body along it. Callable before `entity.add()`; the locks apply at body creation.
- `lockRotations(locked)` — lock or unlock rotation. A locked body ignores torques and contact spin; `setAngularVelocity` still turns it. Callable before `entity.add()`.
- `setGravityScale(scale)` / `gravityScale` — per-body gravity multiplier at runtime. `1` is scene gravity, `0` removes it, higher falls faster. Use it for variable jump height and fast-fall, where one body must fall differently from the rest. `scale` must be finite. Callable before `entity.add()`; the value applies at body creation.
- `type: BodyType` — read the current body type
- `setType(type)` — switch the body type at runtime: a dead enemy becomes `"static"` so nothing pushes it and it pushes nothing, a carried crate becomes `"kinematic"` while held. Linear and angular velocity are cleared by the switch; locks, gravity scale, damping, colliders and mass are kept, and the drawn pose is the pose at the switch. Callable before `entity.add()`; the body is created as the new type.

### Reading positions

A dynamic or kinematic body has two positions, and they differ within a frame:

- `entity.get(Transform).worldPosition` — the drawn pose. Blended between the last two fixed steps, so it moves smoothly at the display frame rate and is at most one fixed step behind the simulation. Use it for anything visual: camera follow, HUD markers, spawning effects at a body.
- `rb.position` / `rb.positionX` / `rb.positionY` / `rb.rotation` — the exact simulated pose, as of the last completed fixed step. Use it when a number must match the simulation: distance thresholds, snapping a body to a grid, saving a checkpoint.

Interpolation runs at the start of `Update`, so the `Transform` a component's `update(dt)` reads is the one that gets drawn that frame. Raycasts, collision events, and other physics queries always report exact poses — they run inside the simulation, not against the `Transform`.

### Writing positions

A dynamic body's `Transform` is written by physics every frame. A write to it while the entity is active is overwritten before the next step and never reaches the body — move a dynamic body with `setVelocity`, `applyImpulse` or `rb.setPosition`. A write made while the entity is inactive is the game repositioning a pooled member: it teleports the body there when the entity is enabled again, for dynamic and kinematic bodies alike.

A static body never reads its `Transform`; `rb.setPosition` / `rb.setRotation` move body and `Transform` together.

### Velocity while the scene is slowed

Physics runs at the scene's effective time scale, and an entity excluded from a slow-motion effect still has its velocity integrated at the slowed rate. Scale velocity writes by the ratio of the two rates:

```ts
const time = this.use(SceneTimeKey);

const world = time.effectiveScale;
const factor = world > 0 ? time.effectiveScaleForUpdates(entity) / world : 1;
rb.setVelocity(dir.scale(speed * factor));
```

The factor is `1` while the scene is frozen — nothing integrates, so nothing needs compensating.

### Moving kinematic bodies

Write the `Transform` (`setPosition`, `translate`) in `fixedUpdate`; the body reaches the written pose on the next physics step and is drawn interpolated, so the drawn gap to dynamic bodies riding it stays constant. A write from `update()` lands after that frame's interpolation pass: the frame shows the raw pose, then drawing re-blends from the last two steps, so a one-shot write visibly hops — prefer `fixedUpdate`. `rb.setPosition()` / `rb.setRotation()` teleport instead — no smoothing.

## ColliderComponent

```ts
import { ColliderComponent } from "@yagejs/physics";

entity.add(
  new ColliderComponent({
    shape: { type: "box", width: 64, height: 32 },
    // shape: { type: "box", width: 64, height: 32, borderRadius: 4 },  // rounded corners, same outer footprint
    // shape: { type: "circle", radius: 16 },
    // shape: { type: "capsule", halfHeight: 20, radius: 10, axis: "y" },   // axis defaults to "y" (vertical); "x" rotates 90°
    // shape: { type: "polygon", vertices: [{x,y}, ...] },                  // closed convex, >= 3 vertices not all on one line; concave input is silently widened by Rapier (dev warning logged)
    // shape: { type: "polyline", vertices: [{x,y}, ...] },                 // chain of segments, >= 2 vertices; supports non-convex; static-only (no inertia)
    restitution: 0.5, // finite and >= 0
    friction: 0.3, // finite and >= 0
    density: 1, // finite and >= 0; default 1
    // contactSkin: 1,    // holds the collider 1px off whatever it touches; finite and >= 0
    sensor: false, // true = trigger (no physical response)
    offset: { x: 0, y: 0 },
    rotation: 0, // radians, relative to the body, about the offset point (axis:"x" capsules: adds to the 90° axis rotation)
    layers: LAYER_PLAYER, // bitmask
    mask: LAYER_WALL, // which layers to interact with
  }),
);
```

One component can attach several ordered shapes to the same body. Each part
has its own shape, offset, and rotation. The other settings apply to every
part, and Rapier sums their mass:

```ts
entity.add(
  new ColliderComponent({
    parts: [
      { shape: { type: "box", width: 48, height: 16 } },
      {
        shape: { type: "circle", radius: 8 },
        offset: { x: 24, y: 0 },
      },
    ],
    friction: 0.3,
    layers: LAYER_PLAYER,
    mask: LAYER_WALL,
  }),
);
```

`collider.colliderCount` is the number of parts. `getOverlapping()` checks all
parts and returns each overlapping entity once.

Collider geometry follows `Transform.worldScale` automatically. The scale in
place when the component is added applies immediately; later local or ancestor
scale writes apply at the next physics step. Scale changes update part offsets
and recompute mass from `density`. A query before the next step sees the last
simulated scale, like position queries.

Positive uniform scale keeps Rapier's native primitives. For non-uniform or
mirrored scale, polygons and polylines transform exactly. Boxes become their
four transformed corners. Circles, capsules, and rounded boxes use a 32-point
convex outline because Rapier has no scaled equivalent for those shapes. A
zero scale axis disables the colliders and removes their mass until both axes
are non-zero again.

A capsule's `halfHeight` is half the straight section; each cap adds `radius`,
so the collider is `2 * (halfHeight + radius)` tall — `{ halfHeight: 20, radius: 10 }`
stands 60 px. `halfHeight: 0` is a circle. Boxes and circles take outer
dimensions.

Every entry that takes a shape (`ColliderComponent`, `setShape`, `castShape`,
`queryShape`, `queryRadius`) throws on a dimension that is not finite and above
0, naming the field: `width`, `height`, `radius` above 0, `halfHeight` at least
0, `borderRadius` at least 0 and smaller than half the shorter side, polygon and
polyline vertex counts and coordinates as above.

`box.borderRadius` rounds the corners. The inner half-extents shrink by the
radius, so the outer footprint stays the configured width and height and a
resting body keeps its height. `0` and `undefined` create a plain box; a radius
that is not smaller than half the shorter side throws. Rounded geometry is used
by collision, `castShape`, and `queryShape`. Mass is the rounded footprint's
area at the configured `density`, so rounding changes it only by the four
corner pieces; angular inertia is the inner rectangle's, scaled by the same
area ratio (an approximation).

Rounding shrinks the flat part of each face to `width - 2 * borderRadius`, so a
body held up only by the last `borderRadius` pixels of a ledge slides off
instead of standing on it.

`contactSkin` holds the collider that many pixels off whatever it touches, so a
resting body sits that far above the surface. When both colliders in a pair set
a skin, the gap is the sum of the two. It affects contacts only, not shape
queries.

A driven box can catch on the junction between two segments of a `polyline` and
stop moving, because Rapier picks a contact normal that opposes the walk
direction. Either option prevents that. Prefer `borderRadius`, since
`contactSkin` also raises the body off the ground.

Events:

A `sensor: true` collider fires only `onTrigger`; a solid collider fires only `onCollision`. Register the wrong one and it never fires — dev builds log a warning when you add the handler.

Events are collected after every physics step and delivered after that step, so a scene running above `timeScale` 1 receives every transition, in order, each with its own step's contact data. Handlers run with Transforms synced to the step that produced the contact, and a handler's `setVelocity` or `destroy` takes effect before the next step of the same tick.

```ts
collider.onTrigger((ev) => {
  ev.other;
  ev.selfShapeIndex;
  ev.otherShapeIndex;
  ev.entered;
}); // sensor events
collider.onCollision((ev) => {
  ev.other;
  ev.selfShapeIndex;
  ev.otherShapeIndex;
  ev.started;
  // contactNormal/contactPoint/penetrationDepth/contactImpulse(Vector): only
  // on started, non-sensor collisions, and may be absent if no contact
  // manifold is available. A pair can touch along several surfaces at once
  // (a box crossing a polyline corner); the geometry below describes the
  // deepest of those contacts.
  ev.contactNormal; // Vec2, unit, points from this entity toward `other`
  ev.contactPoint; // Vec2, world pixels, the deepest contact's point (not an
  // average); equally deep points are interchangeable
  ev.penetrationDepth; // number, world pixels, that contact's overlap, >= 0
  ev.contactImpulse; // number, magnitude of the solver's contact impulse (no friction),
  // `applyImpulse` units; divide by a dynamic body's getMass() for
  // the speed change that body received, px/s
  ev.contactImpulseVector; // Vec2, the same impulse as a vector, oriented from this entity
  // toward `other` like contactNormal; the push on this body is
  // its negation (scale(-1/getMass()) = a dynamic body's velocity
  // change, px/s)
});
// Both return unsubscribe function
```

Score impacts with `contactImpulse` — velocity read inside the handler is measured after the solver resolved the contact, so hard hits read near zero.

Knockback example:

```ts
collider.onCollision((ev) => {
  if (!ev.started || !ev.contactNormal) return;
  const knockback = ev.contactNormal.scale(-300); // push this entity away from `other`
  entity.get(RigidBodyComponent).setVelocity(knockback);
});
```

Overlap queries report only pairs where this collider or the other is `sensor: true`; two solid colliders never report, however deeply they penetrate. For solid-vs-solid contact (contact damage, say) use `onCollision`. This is the one query that is about sensors: `PhysicsWorld`'s `raycast`, `castShape`, `queryShape` and `queryRadius` skip sensor colliders unless asked for them.

```ts
collider.getOverlapping(); // Entity[]
collider.getOverlapping({ tags: ["enemy"] }); // filtered
collider.getOverlappingComponents(Health); // Component[]
```

Resizing:

```ts
collider.setShape({ type: "box", width: 20, height: 20 }); // crouch
collider.setShape({ type: "box", width: 20, height: 40 }); // stand back up
collider.setShape(newHeadShape, { index: 1 }); // replace compound part 1
```

`setShape(shape, options?)` replaces one shape on the live collider component.
`options.index` defaults to `0`. It must name an existing part. The body
attachment and every `onCollision`/`onTrigger` subscription survive. Callable
before `entity.add()`; the shape applies at collider creation. A bad shape or
index throws before anything is stored, so the config still describes the live
collider.

The body keeps its mass. A collider is a collision proxy, not a measure of matter, so a crouching character takes the same `applyImpulse` knockback as a standing one. Pass `{ recomputeMass: true }` when the shape change means genuinely more or less matter and mass should come back from density × the new shape.

```ts
collider.setShape(small); // same mass
collider.setShape(big, { recomputeMass: true }); // heavier
```

Shrinking never pushes anything out of the way, and growing can leave the collider overlapping geometry it clears at the smaller size. Check clearance before growing back.

Switching kinds:

```ts
collider.setSensor(true); // solid → sensor: falls through what it rested on
collider.setSensor(false); // sensor → solid: pushed out to rest
```

`setSensor(bool)` recreates the Rapier collider with the new flag. Every pair it is in ends with a `stop`/`exit` at the next step and re-forms as the new kind. `getMass()`, the contact filter, and every subscription are unchanged; the collider handle changes. A call that does not change the flag does nothing. Dev builds warn when the flip leaves handlers of the silenced kind registered (`onCollision` on a sensor, `onTrigger` on a solid). Callable before `entity.add()`; the flag applies at collider creation.

A collider is centred on its body's origin unless given an `offset`, so growing upward with the feet planted also moves the body up by half the gained height. Query the standing box where it will sit, not where the crouched one sits — querying at the crouched position reports the floor as a blocker whenever the character is grounded, so they can never stand.

```ts
const rise = (STAND_HEIGHT - CROUCH_HEIGHT) / 2;
const standing = { type: "box", width: 20, height: STAND_HEIGHT } as const;
const pos = transform.worldPosition;

const blocked =
  world.queryShape(
    standing,
    { x: pos.x, y: pos.y - rise },
    { excludeEntity: entity },
  ).length > 0;

if (!blocked) {
  collider.setShape(standing);
  rb.setPosition(pos.x, pos.y - rise);
}
```

Removing just the collider (`entity.remove(ColliderComponent)`) frees the Rapier collider and its internal lookup entries while the sibling body stays alive. Removing the whole entity, or the `RigidBodyComponent`, also removes every attached collider; the `ColliderComponent`s left behind no longer hold a collider handle, so their later calls do nothing.

## One-Way Platforms

```ts
platform.add(
  new ColliderComponent({
    shape: { type: "box", width: 96, height: 8 },
    oneWay: {}, // solid from above, passable from below
    // oneWay: {
    //   direction: { x: 0, y: -1 },          // solid-face direction, body-local; default up; non-zero, both finite
    //   margin: 4,                           // px of overlap that still lands; default 4; finite
    // }
  }),
);

riderCollider.dropThrough(0.2); // this body falls through one-way platforms for 0.2s
riderCollider.isDroppingThrough; // boolean, true while the window is open
```

- A body lands on the face `direction` points at, passes through from every other side, and a body already inside the platform keeps passing until clear — it is never snapped to the surface.
- `dropThrough(seconds)` is per body: other bodies on the same platform stay supported. Seconds of simulated time (respects pause/timeScale). Wakes a sleeping body. Callable before `entity.add()`.
- `direction` is in the platform body's local frame and rotates with the body.
- A body that travels more than the platform-plus-body thickness in one step can cross the platform undetected; give it `ccd: true`. Rapier's CCD sweep honors one-way filtering, including drop-through.
- `oneWay` is part of collider construction. It has no effect on `sensor: true` colliders (dev warning).

## Contact Filters

Decide per pair, per step, whether two colliders collide. `oneWay` is built on this; use it directly for rules `oneWay` can't express:

```ts
collider.setContactFilter((contact) => {
  contact.other; // Entity on the other side
  contact.otherCollider; // its ColliderComponent
  contact.selfX;
  contact.selfY;
  contact.selfRotation; // own collider, px / radians
  contact.otherX;
  contact.otherY;
  contact.otherRotation;
  contact.selfVelocityX;
  contact.otherVelocityY; // body velocities, px/s
  contact.dt; // current step, seconds
  return true; // true = solid, false = pass through
});
collider.setContactFilter(null); // remove
```

- Runs inside the physics step for every candidate pair involving the collider, every step. Keep it cheap; don't create or destroy entities, bodies, or colliders from inside it. The `contact` object is reused across calls — read, don't store.
- While any collider in the world has a filter (a `oneWay` platform counts), every step reads every collider's pose and velocity before stepping: about 0.8 ms per step at 2000 colliders.
- No contact normal or point exists yet. Positions/velocities are from the start of the step, so a body that crossed a surface mid-step still shows which side it came from.
- When both colliders in a pair have filters, both run for every candidate pair; the pair is solid only if both return `true`.
- A filter that throws is reported (`Inspector.getErrors().callbackErrors`) once per installed filter and the pair stays solid.
- `setContactFilter` replaces the built-in filter a `oneWay` config installed. Register custom filters during normal component setup whenever the scene is constructed.
- Contact pairs only — sensor/trigger pairs are unaffected.

## CollisionLayers

```ts
import { CollisionLayers } from "@yagejs/physics";

const layers = new CollisionLayers();
const PLAYER = layers.define("player"); // bitmask value
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
const hit = world.raycast(origin, direction, maxDistance, {
  filterGroups,
  sensors,
});
// hit: { entity, point: Vec2, normal: Vec2, distance } | null

// Overlap queries — what a shape touches where it already stands
world.queryShape(shape, position, {
  rotation,
  filterGroups,
  excludeEntity,
  sensors,
}); // Entity[]
world.queryRadius(center, radius, { filterGroups, excludeEntity, sensors }); // Entity[]
world.queryOverlapping(colliderHandle); // Entity[]

// sensors: "exclude" (default) reports solid colliders only, "include" reports
// both, "only" reports sensors. On raycast, castShape, queryShape, queryRadius.
world.raycast(origin, direction, maxDistance, { sensors: "include" });

// Advance the simulation directly (a scene's PhysicsSystem does this for you).
// dt must be finite and >= 0; 0 rebuilds the query index without moving
// anything.
world.step(dt);

// Shape cast — sweep a shape along a direction and report the first hit.
// Same result shape as raycast: `distance` is how far the shape travelled,
// `point` the world contact point, `normal` the surface normal on the entity
// hit. A shape already overlapping something at `origin` reports distance 0.
// Direction is normalized internally; a zero-length direction throws.
const swept = world.castShape(shape, origin, direction, maxDistance, {
  rotation,
  filterGroups,
  excludeEntity, // pass the mover when the sweep starts inside its own collider
  sensors,
});
```

`raycast`, `castShape`, `queryShape` and `queryRadius` skip sensor colliders
unless `sensors` says otherwise, so a ground check or a line of sight reports
surfaces rather than trigger zones. `queryOverlapping` is the exception: it
reports Rapier's intersection pairs, which exist only when one side is a sensor.

All five report every live collider at its current pose. When colliders were
created, re-shaped, enabled, disabled or teleported since the last physics step, the
query first runs a zero-duration step, so a collider spawned this frame is
already seen. That step moves nothing and advances no simulated time; contact
events for pairs that already overlap are collected then and arrive at the next
delivery, with `contactImpulse` 0. It costs one extra physics step on a frame
that both changed colliders and queried.

Use `castShape` to test a move before committing to it: carrying a rider on a moving platform, spotting a closing platform before it traps the player, or checking clearance for a fast fall. `queryShape` only reports overlaps at a fixed position and misses anything the shape would pass through on the way.

## Joints

Connect two rigid bodies in the same scene's physics world. Both bodies must
already be added to that world, and both entities must be active:

```ts
const rope = world.addJoint(playerBody, anchorBody, {
  type: "rope",
  length: 120, // maximum distance, pixels
  anchorA: { x: 0, y: 0 }, // local pixels, optional
  anchorB: { x: 0, y: 0 }, // local pixels, optional
});

const spring = world.addJoint(playerBody, companionBody, {
  type: "spring",
  restLength: 80, // pixels
  stiffness: 40,
  damping: 4,
});
```

`addJoint(bodyA, bodyB, config)` returns a `JointHandle`. `attached` is `true`
while the joint is live. `remove()` detaches it; calling it again does nothing.
Destroying or disabling either jointed entity (e.g. releasing it to a pool)
detaches the joint automatically — re-enabling does not restore it, and
`addJoint` throws for an inactive entity (add the joint in `onAcquire`, where
the entity is already active). A rope to a static body is the usual pattern
for a tether or swing. Lengths and anchors are in pixels; every number must be
finite, and `length`, `restLength`, `stiffness` and `damping` at least 0.
Spring `stiffness` and `damping` are mass-relative and passed to the solver
unconverted; collider mass depends on `pixelsPerMeter` (density × area in
meters), so retune them after changing the scale.

## Save state

Rapier bodies, colliders, joints, contacts, and callbacks are runtime objects.
Save stable physics facts in the game's state root, then construct components
and joints through normal scene setup after load.
