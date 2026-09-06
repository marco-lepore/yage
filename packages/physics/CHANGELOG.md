# @yagejs/physics

## 0.11.0

### Minor Changes

- [#304](https://github.com/marco-lepore/yage/pull/304) [`daa8214`](https://github.com/marco-lepore/yage/commit/daa821458a69d14176f5c5aebc3f4204348ddb0c) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Remove automatic rigid-body and collider snapshot methods and their serialized
  data types. Rebuild physics components from explicit domain state when loading
  a scene.

- [#328](https://github.com/marco-lepore/yage/pull/328) [`05492cb`](https://github.com/marco-lepore/yage/commit/05492cb8e27f89fe82fedd6e307afa2f90d1f68f) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Keep diagnostic frames, clock control, and scene state consistent.
  - Draw collider diagnostics through the owning scene's camera and omit hidden scenes.
  - Include physics elapsed time in diagnostic snapshots.

- [#308](https://github.com/marco-lepore/yage/pull/308) [`01f3944`](https://github.com/marco-lepore/yage/commit/01f39449f8856d1ed0e3e842a6ea1173a7a49ec6) Thanks [@marco-lepore](https://github.com/marco-lepore)! - A destroyed body reference no longer drives another entity, spatial queries skip sensors and see colliders spawned this frame, and `setType` changes a body's type at runtime.
  - Fixed: a reference held past `entity.destroy()` no longer reads and writes the first body in the world. `RigidBodyComponent` holds `-1` before it is added and after it is destroyed, and Rapier decodes that handle to whichever body sits at index 0, so `bullet.rb.position` returned the player's pose and `bullet.rb.applyImpulse({ x: 1000 })` launched the player at 6250 px/s. `PhysicsWorld.getBody` and `getCollider` now resolve only handles this world issued and has not freed — a handle Rapier has reused, or one from another scene's world, resolves to `undefined`, which makes the documented fall-back to the entity's own `Transform` position real.
  - Fixed: `entity.remove(RigidBodyComponent)` no longer leaves the sibling `ColliderComponent` holding a handle the next collider reuses. The stale component's `setShape` shrank an unrelated fresh collider, its `setSensor(true)` made that collider a sensor, and its teardown detached it from its own body. Removing a body now clears each attached collider component's handle, so its later calls do nothing.
  - Fixed: `setEnabledTranslations` and `lockRotations` work before `entity.add()` and survive body creation. Both threw a `TypeError` before the component was added, and neither wrote the construction config, so a lock applied at runtime was lost whenever the body was recreated. They now write config first, like `setGravityScale`, `setSensor` and `setShape`.
  - Fixed: `rb.setPosition` and `rb.setRotation` on a static body move the entity's `Transform` with the body. The collider moved and the sprite stayed behind, though the docs recommend `setPosition` for a moving platform, which is usually a static body.
  - Fixed: a `Transform` write made while a dynamic entity is inactive teleports the body there when the entity is enabled again, as it already did for kinematic bodies. Repositioning a pooled member through its `Transform` was silently lost on re-acquire.
  - Fixed: a rejected `setShape` no longer leaves the component's config describing a shape the collider does not have. The shape is validated before it is stored.
  - Added: `RigidBodyComponent.setType(type)` switches a body between `"dynamic"`, `"static"` and `"kinematic"` at runtime — a corpse nothing can shove, a crate carried as kinematic, a door knocked loose. Linear and angular velocity are cleared by the switch; locks, gravity scale, damping, colliders and mass are kept, and the drawn pose is the pose at the switch. Callable before `entity.add()`.
  - Changed: creating a collider compares its layers and mask against each distinct layer signature in the world instead of against every existing collider. The scan cost grew with the square of the collider count; building a 6000-collider level now takes 51 ms instead of 85 ms, and the scan itself no longer grows. The asymmetric-mask dev warning is unchanged.
  - Documented: a capsule's `halfHeight` is half the straight section and each cap adds `radius`, so `{ halfHeight: 20, radius: 10 }` stands 60 px tall while boxes and circles take outer dimensions.
  - Documented: `applyTorque` and `setAngularVelocity` are in Rapier's native units. Angular inertia scales with `pixelsPerMeter`⁻⁴, so the same torque spins a body 16× faster at 100 px/m than at 50.
  - Documented: a dynamic body's `Transform` is engine-written while the entity is active — move it with `setVelocity`, `applyImpulse` or `rb.setPosition` — plus the velocity factor that compensates a scene slow an entity is excluded from.

  **Breaking**, all pre-1.0:
  - `raycast`, `castShape`, `queryShape` and `queryRadius` skip sensor colliders by default. A ground check standing in a coin's trigger zone reported the coin as ground, and no option could exclude it. Pass `sensors: "include"` for the previous behaviour, or `"only"` for trigger zones alone. `collider.getOverlapping` still reports sensor pairs only.
  - Those four queries and `queryOverlapping` now report every live collider at its current pose. They read Rapier's query index, which only a physics step rebuilds, so a collider created, re-shaped, enabled or teleported since the last step was invisible, and one disabled since then was still reported — a wall spawned this frame did not block a ray, a pathfinding grid built at level-build time read every cell as empty, and a bullet released to its pool still blocked a query. A query on such a frame first runs a zero-duration step: it moves nothing, advances no simulated time, keeps sleeping bodies asleep, and collects contact events for pairs that already overlap, which arrive at the next delivery with `contactImpulse` 0. It costs one extra step (0.2 ms at 3000 colliders) on a frame that both changed colliders and queried.
  - Every entry that takes a collider shape — `new ColliderComponent`, `setShape`, `castShape`, `queryShape`, `queryRadius` — throws unless each dimension is finite and above 0 (a capsule's `halfHeight` may be 0, which is a circle), a box `borderRadius` is at least 0 and smaller than half the shorter side, a polygon has at least 3 vertices not all on one line, and a polyline has at least 2. Rapier accepted all of these and failed later: a zero extent gave a body zero mass that gravity could not move, a negative one made it fall through solid ground, a non-finite one wrote `NaN` into the body's position every step, and a degenerate polygon trapped the WebAssembly module. `queryRadius` requires a finite radius above 0.
  - `RigidBodyComponent.setGravityScale` throws unless `scale` is finite. `NaN` corrupted the body's position permanently — resetting the scale and zeroing velocity did not recover it.
  - `PhysicsWorld.step(dt)` throws unless `dt` is finite and at least 0.
  - `RigidBodyComponent.type` is a getter backed by `setType`, so a subclass can no longer assign it.

- [#308](https://github.com/marco-lepore/yage/pull/308) [`01f3944`](https://github.com/marco-lepore/yage/commit/01f39449f8856d1ed0e3e842a6ea1173a7a49ec6) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Collision events are delivered after every physics step, rounded boxes weigh what their footprint covers, `setSensor` takes effect on existing contacts, and the physics constructors reject numbers they cannot simulate.
  - Fixed: a scene running above `timeScale` 1 no longer loses collision and trigger events. Rapier's event queue was drained once per fixed tick after up to eight steps, and the queue discards undrained events at the start of each step, so only the last step's transitions survived: at 3 steps per tick a box landing on the ground reported nothing, and a bullet crossing a sensor band lost its exit. Events are now collected after every step, with that step's contact data, and delivered after that step. Handlers run with Transforms synced to the step that produced the contact, and a handler's `setVelocity` or `destroy` takes effect before the next step of the same tick.
  - Fixed: a one-way platform no longer locks solid from below, or drops its rider, after a lost event. The platform's landed-rider set is maintained from the events, so the same loss left a rider registered after it had left (a later jump from below was blocked, and stayed blocked after the time scale returned to 1) or never registered at all (a rider fell through a `margin: 0` platform).
  - Fixed: a box with `borderRadius` now weighs what its footprint covers. Rapier weighs a rounded box by its inner rectangle alone, so a 20×20 box with `borderRadius: 5` had a quarter of the mass of a plain one, and the same `applyImpulse` moved it four times as fast. The collider's density is now scaled so the mass is the rounded footprint's area at the configured `density`; angular inertia is the inner rectangle's scaled by the same ratio, an approximation the docs name. `setShape(shape, { recomputeMass: true })` reapplies the factor for the new shape.
  - Fixed: `setShape` without `recomputeMass` keeps the body's mass in every case. A body that had not stepped yet, or was asleep, had its mass recomputed from density × the new shape at the next step.
  - Fixed: `ColliderComponent.setSensor` now takes effect on the collider's existing contacts. Rapier does not apply a sensor-flag change to an awake body's existing pairs, so a solid box flipped to a sensor stayed resting on the ground, and a sensor flipped to solid fell through it. The Rapier collider is now recreated with the new flag: every pair it is in ends with a `stop`/`exit` at the next step and re-forms as the new kind, `getMass()` and the contact filter and every subscription are unchanged, and the collider handle changes. A same-value call does nothing. Dev builds warn when the flip leaves handlers of the silenced kind registered.
  - Fixed: both contact filters run for every candidate pair. When the first filter Rapier consulted vetoed the pair, the other collider's filter was skipped, and which one came first was Rapier's handle order.
  - Documented: while any collider has a contact filter (a `oneWay` platform counts), every step reads every collider's pose before stepping — about 0.8 ms per step at 2000 colliders.

  **Breaking**, all pre-1.0:
  - `new PhysicsPlugin(config)` and `new PhysicsWorld(config)` throw unless `pixelsPerMeter` is finite and above 0, and both gravity components are finite. A `pixelsPerMeter` of `0` produced a `NaN` world.
  - `new RigidBodyComponent(config)` throws unless `linearDamping` and `angularDamping` are finite and at least 0, and `gravityScale` is finite. A negative damping grew a body's speed without bound.
  - `new ColliderComponent(config)` throws unless `restitution`, `friction`, `density` and `contactSkin` are finite and at least 0, `oneWay.margin` and `oneWay.direction` are finite, and `oneWay.direction` is not the zero vector. A zero direction made the platform solid from every side.
  - `PhysicsWorld.addJoint` throws unless every number in the config is finite and `length`, `restLength`, `stiffness` and `damping` are at least 0. A negative spring `damping` diverged.
  - `PhysicsWorld.addJoint` throws when either entity is inactive. A joint added to a dormant body skipped the detach that disabling performs and survived into the entity's next life. For a pooled entity, add the joint in `onAcquire`.
  - Every error names the input and the constraint.
  - Collision handlers run more than once per fixed tick above `timeScale` 1.
  - `getMass()` changes for every rounded box.

- [#326](https://github.com/marco-lepore/yage/pull/326) [`0273a69`](https://github.com/marco-lepore/yage/commit/0273a69dfe675e636e1488c6c81c9072c1e64b35) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add runtime controls for body damping, collider materials, and collider shape placement.
  - Add `setLinearDamping` and `setAngularDamping` to `RigidBodyComponent`.
  - Add `setRestitution` and `setFriction` to `ColliderComponent`, applying each value to every compound part.
  - Let `ColliderComponent.setShape` change a selected part's body-local offset with its shape in one validated call.
  - Reject non-finite scaled collider geometry before initial attachment or a runtime `Transform` scale change reaches Rapier.

- [#324](https://github.com/marco-lepore/yage/pull/324) [`a7eda5d`](https://github.com/marco-lepore/yage/commit/a7eda5d7cee1e163ea09362709d7ab35687f0fb6) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add compound colliders and keep collider geometry aligned with entity scale.
  - Add ordered collider parts, per-part contact indices, and indexed shape replacement.
  - Apply live world scale to collider geometry, offsets, mass, and one-way directions.

### Patch Changes

- [#318](https://github.com/marco-lepore/yage/pull/318) [`33d00e3`](https://github.com/marco-lepore/yage/commit/33d00e37801a300710cc10de0352b1aa1b1ba2f1) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Keep debug-overlay contributions available without adding `@yagejs/debug` to
  the physics package's runtime install graph.

- [#336](https://github.com/marco-lepore/yage/pull/336) [`0bc41ac`](https://github.com/marco-lepore/yage/commit/0bc41ac6c3cce2770a588d90f2662b21c458ed71) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Apply position and rotation written to a static body's Transform while its entity is inactive when the entity is activated. This keeps the collider aligned with dormant level placement and prewarmed pool setup. Active static bodies still move through `setPosition` and `setRotation` on the rigid body.

  Refresh spatial queries after activation teleports for every body type, including when only the rigid-body component is re-enabled.

- [#329](https://github.com/marco-lepore/yage/pull/329) [`8d7b5e3`](https://github.com/marco-lepore/yage/commit/8d7b5e3fe395898c7f4cbde0b352acc2713e6559) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add caller-owned vector buffers and coordinate reads without Vec2 construction.
  - Add `getVelocityInto` and `getPositionInto` and preserve the other velocity coordinate with one Rapier read in scalar setters.
  - Store interpolation positions as numbers and synchronize Transform poses and collider scales without constructing vectors.

- Updated dependencies [[`dc42ba4`](https://github.com/marco-lepore/yage/commit/dc42ba40cd3bbd04c8ff27bf4e8721f274dde034), [`daa8214`](https://github.com/marco-lepore/yage/commit/daa821458a69d14176f5c5aebc3f4204348ddb0c), [`c105024`](https://github.com/marco-lepore/yage/commit/c105024b5402c11dc36da52b08f6ab39354da8a5), [`c8ad215`](https://github.com/marco-lepore/yage/commit/c8ad215530681caeb63484cc07b118cd977a5ba5), [`08b0d06`](https://github.com/marco-lepore/yage/commit/08b0d06b63a44a51bd6f8e8308574fd41c96af59), [`33d00e3`](https://github.com/marco-lepore/yage/commit/33d00e37801a300710cc10de0352b1aa1b1ba2f1), [`7275620`](https://github.com/marco-lepore/yage/commit/7275620756183b22de3df1009e1e07615db9b40e), [`4bab66f`](https://github.com/marco-lepore/yage/commit/4bab66f0e34a387155bbc7168b048dcac167525f), [`cfde97d`](https://github.com/marco-lepore/yage/commit/cfde97de2c94416cb5bbab26a12f9c290e6b66cf), [`9e194ec`](https://github.com/marco-lepore/yage/commit/9e194ec386a74c0f1ad5699c3c0db183aa86f1b1), [`05492cb`](https://github.com/marco-lepore/yage/commit/05492cb8e27f89fe82fedd6e307afa2f90d1f68f), [`aed53f7`](https://github.com/marco-lepore/yage/commit/aed53f7f5679f824846dee3c55c0342f7f07cf98), [`ba57361`](https://github.com/marco-lepore/yage/commit/ba5736175e8b3e06157e680b4b66d10eb8d06823), [`aaf1279`](https://github.com/marco-lepore/yage/commit/aaf1279455bc655681cf15c8edc64b1407b2a823), [`8064fa6`](https://github.com/marco-lepore/yage/commit/8064fa64099feeb1d164360b668e0721a14b7bbe), [`8f11936`](https://github.com/marco-lepore/yage/commit/8f119362281bf31ab59b8b907816886922aaf18f), [`b087462`](https://github.com/marco-lepore/yage/commit/b087462ab2ae27bebb7ce274402c9e278f6d472a), [`8bb9e0b`](https://github.com/marco-lepore/yage/commit/8bb9e0b905017ac724f70fc8fe55014605563e88), [`8d7b5e3`](https://github.com/marco-lepore/yage/commit/8d7b5e3fe395898c7f4cbde0b352acc2713e6559), [`ff52a8a`](https://github.com/marco-lepore/yage/commit/ff52a8a4816b18f7de5309ab08606183db67e071)]:
  - @yagejs/core@0.11.0

## 0.10.4

### Patch Changes

- Updated dependencies [[`7a0d56e`](https://github.com/marco-lepore/yage/commit/7a0d56e3540e246673353b7b6facfeebedb2a51f), [`753050b`](https://github.com/marco-lepore/yage/commit/753050b08270af8a73f694e27ca886613c1b57fa), [`383b8e7`](https://github.com/marco-lepore/yage/commit/383b8e710d6eb3c673e52b5a1386478dfafa2bea)]:
  - @yagejs/core@0.10.4
  - @yagejs/debug@0.10.4

## 0.10.3

### Patch Changes

- Updated dependencies [[`3cb9d19`](https://github.com/marco-lepore/yage/commit/3cb9d190e4720816c7ba83a1e6fafd4b05d2684e), [`d337ce3`](https://github.com/marco-lepore/yage/commit/d337ce3a0a8eddce46117d7ff17eabbb6f2d03b3), [`f106e5d`](https://github.com/marco-lepore/yage/commit/f106e5d3bcc0f8a6a8aa449fee9a0f9c187b4d35), [`6eaad69`](https://github.com/marco-lepore/yage/commit/6eaad6992b0923ec194e3d5e5c3f1eb812afbee8), [`83c9993`](https://github.com/marco-lepore/yage/commit/83c999385c645f158dc3ef7a8cdd995fd9f2b37c), [`31d6435`](https://github.com/marco-lepore/yage/commit/31d6435fd4260363988603fdc2e292478247e314)]:
  - @yagejs/core@0.10.3
  - @yagejs/debug@0.10.3

## 0.10.2

### Patch Changes

- [#251](https://github.com/marco-lepore/yage/pull/251) [`57c25b3`](https://github.com/marco-lepore/yage/commit/57c25b36735b71f7032fb6f1f577b434fb459df1) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add `PhysicsWorld.addJoint`, connecting two rigid bodies with a spring or rope joint. The returned handle reports `attached` and detaches the joint via `remove()`, which is safe to call more than once. Joints detach automatically when a jointed entity is disabled or destroyed.

- [#250](https://github.com/marco-lepore/yage/pull/250) [`97e550e`](https://github.com/marco-lepore/yage/commit/97e550e72e3d9c224f762a67c0a91b97d4471ad8) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Collision events include optional `contactImpulse` and `contactImpulseVector` values in pixel-based impulse units, so games can score impacts and derive push direction without reading the body's post-solve velocity.

- [#252](https://github.com/marco-lepore/yage/pull/252) [`b13da93`](https://github.com/marco-lepore/yage/commit/b13da93e799bfd906c28991cea5549895c341d52) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Collision events describe the deepest contact of the pair, so `contactNormal` reports the surface actually resisting the body.

  A collider pair can produce several contact manifolds in one step: one per segment against a polyline chain, and more than one for a box resting on a corner. Rapier's manifold order depends on the approach direction, and `contactNormal`, `contactPoint`, and `penetrationDepth` were read from whichever manifold came first. A box walking onto the same tilemap ramp received the slope face normal from one side. From the other it received the normal of the chain's closing edge, which is coplanar with the floor and describes the ramp as level ground. Code that classifies ground by normal worked in one direction only.

  Those three fields now come from the solver contact with the greatest overlap across every manifold of the pair. Reported values change only where the deepest contact was not in the manifold Rapier happened to report first. That needs a pair touching more than one surface at the same time, which is routine on polyline terrain and compound colliders. `penetrationDepth` is that deepest contact's overlap, still clamped to `>= 0`. `contactImpulse` and `contactImpulseVector` are unchanged: they still sum every manifold's impulse along its own normal.

- [#255](https://github.com/marco-lepore/yage/pull/255) [`2785ce9`](https://github.com/marco-lepore/yage/commit/2785ce964623feeb8478301fdb350a1806ee41b4) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Rounded box colliders and contact skins, so a walking body stops catching on terrain polyline junctions.

  A box driven across a `polyline` terrain chain can stop moving at the junction between two segments. Rapier builds polyline contacts one segment at a time, and where a foot corner meets a vertex it picks a contact normal that opposes the walk direction. The contact regenerates every step, so the body never gets past the vertex.
  - The box `ColliderShape` accepts `borderRadius`, which rounds the corners. The inner half-extents shrink by the radius, so the outer footprint and a resting body's height stay the same. The flat part of each face shrinks to `width - 2 * borderRadius`, so a body held up only by the last few pixels of a ledge slides off it. Shape casts and overlap queries use the rounded geometry. A radius that is not a finite number below half the shorter side throws when the collider is built.
  - `ColliderConfig` accepts `contactSkin`, which holds a collider that many pixels away from whatever it touches. A resting body then sits that far above the ground, so prefer `borderRadius` when resting height matters. When both colliders in a pair set a skin, the gap is the sum of the two. Skins apply to contacts, not to queries.
  - The debug overlay draws rounded box colliders at their outer footprint, with the corner radius visible.

- Updated dependencies [[`ef27ea3`](https://github.com/marco-lepore/yage/commit/ef27ea3d1ff31faea4fa77fd6538bd8cadabe606), [`7f0b764`](https://github.com/marco-lepore/yage/commit/7f0b76494d72bd94866436ee46a5669c08d60372), [`2785ce9`](https://github.com/marco-lepore/yage/commit/2785ce964623feeb8478301fdb350a1806ee41b4)]:
  - @yagejs/core@0.10.2
  - @yagejs/debug@0.10.2

## 0.10.1

### Patch Changes

- [#235](https://github.com/marco-lepore/yage/pull/235) [`c05570b`](https://github.com/marco-lepore/yage/commit/c05570b8773a9be7ca72016b6f20ad874d12faed) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Interpolate kinematic bodies between fixed steps, the same way dynamic bodies already are
  - Kinematic bodies are now rendered from the same prev/curr blend as dynamic bodies. The drawn gap between a moving platform and a body riding it stays constant, including through direction reversals.
  - The `Transform` of a kinematic body is the movement input: a pose written there (ideally in `fixedUpdate`) becomes the target the body reaches on the next physics step. Writes from `update()` are picked up one frame later.
  - `rb.setPosition()` teleports any body type, kinematic included: no smoothing, no pull-back toward the previous target. On a kinematic body, `transform.setPosition()` is the smooth one-step move.
  - New `rb.setRotation(radians)` — the rotation counterpart of `rb.setPosition()`.
  - Rotation is drawn along the shortest arc, so a spinning body crossing the ±π boundary no longer draws a one-step reverse sweep.

- [#231](https://github.com/marco-lepore/yage/pull/231) [`ea50de3`](https://github.com/marco-lepore/yage/commit/ea50de3ec6455ceb2a949eba735c61d14462982a) Thanks [@marco-lepore](https://github.com/marco-lepore)! - One-way platforms and per-pair contact filters.
  - `ColliderConfig.oneWay` makes a collider solid from the side its `direction` faces (default `{ x: 0, y: -1 }`, up) and passable from every other side. `direction` is in the platform body's local frame; `margin` (default 4px) is how deep a body may already overlap the face and still land. A body already inside the platform is let out instead of snapped to the surface. Round-trips through save/load.
  - `ColliderComponent.dropThrough(seconds)` lets one body fall through one-way platforms for a window of simulated time — other bodies on the same platform stay supported. `isDroppingThrough` reports the window state. Callable before the component is added.
  - `ColliderComponent.setContactFilter(filter | null)` is the primitive underneath: a `ContactFilter` decides per candidate pair, per step, whether the pair is solid. The reused `ContactCandidate` argument carries both sides' start-of-step positions, rotations, and body velocities plus the other side's `Entity`/`ColliderComponent`; no contact normal exists at filter time. When both colliders have filters, the pair is solid only if both agree. A throwing filter is reported through the error boundary and the pair stays solid for that step.
  - Rapier's physics hooks are passed to the step only while at least one filter is registered, so worlds without filters step exactly as before. Rapier's CCD honors the filtering, including drop-through; fast bodies should enable `ccd: true` as usual.
  - `PhysicsWorld.elapsed` exposes total simulated time in seconds.
  - The debug overlay draws one-way colliders in orange with an arrow toward the solid face.

- [#228](https://github.com/marco-lepore/yage/pull/228) [`e79ca38`](https://github.com/marco-lepore/yage/commit/e79ca381bcf0a693f00618fb0a8f8a6a78fab30e) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Three additions for per-body motion control, all additive:
  - `RigidBodyComponent.setGravityScale(scale)` and the `gravityScale` getter — change one body's gravity multiplier at runtime. `1` is scene gravity, `0` removes it, higher falls faster. Variable jump height and fast-fall need this per body, without moving scene gravity for everything else.
  - `ColliderComponent.setShape(shape, options?)` — replace a collider's shape in place. The Rapier collider, its body attachment, and every `onCollision`/`onTrigger` subscription survive, so a crouch or slide can shrink the collider and restore it without removing and re-adding the component. The body keeps its mass, so a crouching character takes the same `applyImpulse` knockback as a standing one; pass `{ recomputeMass: true }` when the new shape means more or less matter. Growing does not push anything out of the way, so check clearance with `PhysicsWorld.queryShape` before restoring the larger size.
  - `PhysicsWorld.castShape(shape, origin, direction, maxDistance, options?)` — sweep a shape along a direction and get the first hit, as the swept counterpart to `queryShape`. Returns the same `{ entity, point, normal, distance }` result as `raycast`, where `distance` is how far the shape travelled. A shape already overlapping something at `origin` reports `distance: 0`. Direction is normalized internally; a zero-length direction throws.

  Both setters are callable before the component is added; the value applies when the Rapier body or collider is created.

- [#233](https://github.com/marco-lepore/yage/pull/233) [`9757679`](https://github.com/marco-lepore/yage/commit/97576799808c6f9cc40a42f85d37baf39e662708) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Dynamic bodies are drawn at an interpolated position, and their exact simulated pose is readable.
  - Render interpolation blends between the last two fixed steps. Physics runs at a constant rate that rarely lines up with the display refresh rate, and a dynamic body's `Transform` now carries that blend, so a body moving at constant velocity advances by the same distance every frame instead of stepping and pausing.
  - The blend runs at the start of `Update`, before component `update(dt)`. Game logic reads the same position that gets drawn that frame — a camera following a body no longer alternates between two different poses. A paused scene holds its blend still, so pausing does not move anything on screen.
  - `RigidBodyComponent` gains `position`, `positionX`, `positionY` and `rotation` — the exact simulated pose as of the last completed fixed step, for the cases where a number must match the simulation rather than the drawn position. `positionX` / `positionY` skip the `Vec2` allocation. Without a live Rapier body they fall back to the entity's `Transform`.

- Updated dependencies [[`d3a730b`](https://github.com/marco-lepore/yage/commit/d3a730b1dfae45338a53ddcc1267ae3e4102a34a), [`ccc0d71`](https://github.com/marco-lepore/yage/commit/ccc0d71c7f1ae4197b56a5469f61ae4145045391), [`50cc882`](https://github.com/marco-lepore/yage/commit/50cc8825c4365165a5ebfafbb6353c26660daa23)]:
  - @yagejs/core@0.10.1
  - @yagejs/debug@0.10.1

## 0.10.0

### Minor Changes

- [#214](https://github.com/marco-lepore/yage/pull/214) [`042755b`](https://github.com/marco-lepore/yage/commit/042755b5649a90e99c8840747349255fbb3f95be) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Entities can now be turned off and reused instead of destroyed and respawned: `entity.setActive(false)` puts an entity and its whole subtree to sleep, and components get `onEnable` / `onDisable` to release and reacquire live resources.
  - `RigidBodyComponent` and `ColliderComponent` switch their Rapier body and collider out of the simulation on `onDisable` and back in on `onEnable`. The allocations are kept, which is what makes reuse cheaper than respawning.
  - Disabling a body clears its linear and angular velocity and its queued forces and torques, so it cannot resume a motion from a previous life. Re-enabling snaps interpolation to the body's current pose.
  - `PhysicsSystem` and `PhysicsInterpolationSystem` skip dormant entities. Collision and trigger handlers are not called for one, and `getOverlapping` does not report one. Both guards matter because disabling a collider leaves its queued events and its narrow-phase pairs in place until the next step.
  - Known Rapier behavior: a collider disabled and re-enabled while it still overlaps something gets no fresh collision-start event.
  - A rigid body or collider added to a dormant entity starts out of the simulation, so it neither drifts under gravity nor reports contacts until the entity is activated.

- [#216](https://github.com/marco-lepore/yage/pull/216) [`4a5b3b6`](https://github.com/marco-lepore/yage/commit/4a5b3b639ddcbb285b6a4733b89d27bcee14c50c) Thanks [@marco-lepore](https://github.com/marco-lepore)! - The collision drain reads every pair before it dispatches any of them, so a collision queued for an entity's previous life is dropped instead of reaching whatever the pool handed out next. Both sides of a pair are captured with the life they were queued for, and each side is re-checked immediately before its own handler runs, because the first handler can retire the second side's receiver.
  - Releasing an entity from inside `onCollision` or `onTrigger` is safe, including releasing the other side of the pair being handled.
  - Events still queued for an entity a handler released are dropped for the rest of that drain.

### Patch Changes

- [#212](https://github.com/marco-lepore/yage/pull/212) [`34d45fd`](https://github.com/marco-lepore/yage/commit/34d45fd690d747b7d8dd36a5972ef20d21d574da) Thanks [@marco-lepore](https://github.com/marco-lepore)! - A collision or trigger handler that throws is now attributed to the handler itself instead of silently disabling `PhysicsSystem` for the rest of the session.

  Previously the throw propagated up through the system's update call, which permanently disabled physics for every entity with no console output. Now `ColliderComponent` catches the throw at the handler itself, reports it with a full stack trace naming the handler and entity, and rethrows: see the `@yagejs/core` changeset. The failure is recorded and readable via `engine.inspector.getErrors().callbackErrors`.

- [#208](https://github.com/marco-lepore/yage/pull/208) [`6fc90a5`](https://github.com/marco-lepore/yage/commit/6fc90a5635395e18c6f466d36e2477f8264ddbe9) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Removing just a `ColliderComponent` (`entity.remove(ColliderComponent)`) now frees its Rapier collider.

  Previously the collider stayed attached to its body even though the component was gone — raycasts, overlap queries, and collision events kept hitting it. `PhysicsWorld.removeCollider()` frees the Rapier collider and clears its `colliderMap` entry; `ColliderComponent.onDestroy()` calls it. Destroying the whole entity, or removing the sibling `RigidBodyComponent`, still tears down every attached collider as before.

- [#208](https://github.com/marco-lepore/yage/pull/208) [`6fc90a5`](https://github.com/marco-lepore/yage/commit/6fc90a5635395e18c6f466d36e2477f8264ddbe9) Thanks [@marco-lepore](https://github.com/marco-lepore)! - `RigidBodyComponent` gains allocation-free scalar velocity reads: `velocityX`, `velocityY`, `speed`, and `speedSquared`. Each reads a number straight from Rapier without allocating a `Vec2` — prefer these over `getVelocity()` on a per-frame read path. Reading both `velocityX` and `velocityY` calls into Rapier twice.

- Updated dependencies [[`34d45fd`](https://github.com/marco-lepore/yage/commit/34d45fd690d747b7d8dd36a5972ef20d21d574da), [`f48983d`](https://github.com/marco-lepore/yage/commit/f48983dbb4e43c25b455ac3f96e7d8684266bbc3), [`042755b`](https://github.com/marco-lepore/yage/commit/042755b5649a90e99c8840747349255fbb3f95be), [`042755b`](https://github.com/marco-lepore/yage/commit/042755b5649a90e99c8840747349255fbb3f95be), [`f1048ab`](https://github.com/marco-lepore/yage/commit/f1048ab756feee84e593609521c3a58fcfc1c1a7), [`4a5b3b6`](https://github.com/marco-lepore/yage/commit/4a5b3b639ddcbb285b6a4733b89d27bcee14c50c), [`d459026`](https://github.com/marco-lepore/yage/commit/d4590265b9aa5297fb99d20b92bb5a2f19cac0c5), [`d459026`](https://github.com/marco-lepore/yage/commit/d4590265b9aa5297fb99d20b92bb5a2f19cac0c5)]:
  - @yagejs/core@0.10.0
  - @yagejs/debug@0.10.0

## 0.9.0

### Minor Changes

- [#177](https://github.com/marco-lepore/yage/pull/177) [`f1e5480`](https://github.com/marco-lepore/yage/commit/f1e54807bdce778dd399ec6187c5f8a96b0baa90) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Populate `CollisionEvent.contactNormal` and `contactPoint`, and add a new `penetrationDepth` field, on started non-sensor collisions. `contactNormal` is a unit `Vec2` pointing from this entity toward the other entity; `contactPoint` is a representative world-pixel contact point; `penetrationDepth` is the overlap depth in world pixels, clamped to `>= 0`. All three stay `undefined` on stopped collisions, trigger events, and started events where Rapier has no contact manifold yet.

- [#168](https://github.com/marco-lepore/yage/pull/168) [`3d7d69e`](https://github.com/marco-lepore/yage/commit/3d7d69ee94ea1dc4db7b2369127cb3b36eb53556) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Tiled collision-shape extraction and physics/debug correctness fixes, plus collider rotation support.
  - `ColliderConfig` accepts an optional `rotation` (radians, relative to the body, about the collider's offset point), enabling tilted box/capsule colliders — e.g. ramps or angled hitboxes. Applied on both creation paths (`ColliderComponent`/`PhysicsWorld.createCollider` and `toRapierColliders`); for `axis: "x"` capsules it adds on top of the 90° axis rotation.
  - `ColliderComponent.setSensor()` now updates `config.sensor` alongside the Rapier collider, so trigger/collision event routing, the sensor-mismatch warning, and serialized snapshots reflect the live sensor state.
  - `PhysicsWorld.raycast()` normalizes the direction internally: any non-zero vector (e.g. `target.sub(origin)`) now yields correct range and hit distance. A zero-length direction throws.

- [#174](https://github.com/marco-lepore/yage/pull/174) [`9ee8b30`](https://github.com/marco-lepore/yage/commit/9ee8b303555466963fb0c79d39730efff0858ea6) Thanks [@marco-lepore](https://github.com/marco-lepore)! - World-query additions:
  - `PhysicsWorld.queryShape(shape, position, { rotation?, filterGroups?, excludeEntity? })` — all entities with a collider overlapping a `ColliderShape` placed at a pixel position.
  - `PhysicsWorld.queryRadius(center, radius, options?)` — circle sugar over `queryShape`.
  - `PhysicsWorld.raycast` gains `excludeEntity`, skipping every collider of that entity — for rays that start inside the caster's own collider.
  - `RigidBodyComponent.getMass()` — the mass Rapier derives from the attached colliders, for converting a desired velocity change into an impulse (`applyImpulse(dv.scale(body.getMass()))`).

- [#159](https://github.com/marco-lepore/yage/pull/159) [`9b637bc`](https://github.com/marco-lepore/yage/commit/9b637bcd832476a6c47eb4dacb8cf33e9c5139b0) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Change the engine time unit from milliseconds to seconds.

  `Component.update(dt)` / `fixedUpdate(dt)` now receive seconds (~0.0167 at 60fps) instead of milliseconds. `EngineConfig.fixedTimestep` defaults to `1/60` and is expressed in seconds. All duration-based APIs follow: `Process.delay`, `ProcessSlot`/`ProcessComponent.slot` durations, `Tween`/`Sequence.wait`/`Tween.stagger` step, `KeyframeTrack` keyframe `time`, `LoadingScene.minDuration`, scene-transition durations (`fade`/`flash`/`crossFade`/`iris`/`irisReveal`/`chessboard`/`slidePush`), `CameraComponent.shake`/`zoomTo`, `AnimationController.playOneShot`, and effect durations/fades (`hitFlash`, `shockwave`, `fadeIn`/`fadeOut`) are all in seconds.

  Migration: drop any `dt / 1000` conversion in your `update`/`fixedUpdate` code, and pass durations in seconds (e.g. `300` ms becomes `0.3`).

### Patch Changes

- [#192](https://github.com/marco-lepore/yage/pull/192) [`f6c2fa8`](https://github.com/marco-lepore/yage/commit/f6c2fa8e508620fb5356b8e4481a199115a73a45) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Snapshot restore order is now driven by a `restorePriority` static on each component class.
  - `RigidBodyComponent` declares priority 10 and `ColliderComponent` 20, preserving the Transform → body → collider restore chain their `onAdd()` hooks require.

- [#189](https://github.com/marco-lepore/yage/pull/189) [`8a933db`](https://github.com/marco-lepore/yage/commit/8a933db95eedb908ad98e95631d5022fe1e0ef28) Thanks [@marco-lepore](https://github.com/marco-lepore)! - `SceneTime`: per-scene arbitration for time effects — hitstop, slow motion, bullet time, freeze frames.
  - `PhysicsSystem` steps each scene's world under `SceneTime.effectiveScale` (the persistent `scene.timeScale` composed with active freeze/slow-mo requests), so a `freezeFor` hitstop stops rigid bodies. `excludeUpdates` exclusions never apply to physics — the shared world has no per-body time.

- Updated dependencies [[`3d7d69e`](https://github.com/marco-lepore/yage/commit/3d7d69ee94ea1dc4db7b2369127cb3b36eb53556), [`0574e44`](https://github.com/marco-lepore/yage/commit/0574e44d68df2568c57d0275aff139bddebb06da), [`3f7a367`](https://github.com/marco-lepore/yage/commit/3f7a367edc5af8d0d78e6e95bcc709bd8b77d783), [`a5d7d53`](https://github.com/marco-lepore/yage/commit/a5d7d5370fb8db567f4ceb39934574ab5c37a174), [`22f8534`](https://github.com/marco-lepore/yage/commit/22f8534e8dbc9ef054c23a570ab851f8710db68f), [`da97f10`](https://github.com/marco-lepore/yage/commit/da97f10ba7cb7627f48efccf3bfe1836bfac3dbc), [`f6c2fa8`](https://github.com/marco-lepore/yage/commit/f6c2fa8e508620fb5356b8e4481a199115a73a45), [`10d3ac5`](https://github.com/marco-lepore/yage/commit/10d3ac5ec3f3dca593f35728b175df3bfd073bb6), [`8a933db`](https://github.com/marco-lepore/yage/commit/8a933db95eedb908ad98e95631d5022fe1e0ef28), [`9b637bc`](https://github.com/marco-lepore/yage/commit/9b637bcd832476a6c47eb4dacb8cf33e9c5139b0), [`9b02d02`](https://github.com/marco-lepore/yage/commit/9b02d024fe54ea30efef01a109387b839266b791), [`8156b6d`](https://github.com/marco-lepore/yage/commit/8156b6dcc8429b738c3efeb949fafd1cce245330), [`8d061c5`](https://github.com/marco-lepore/yage/commit/8d061c54eb0bbf3aed75b2b943fef1affdce7667)]:
  - @yagejs/debug@0.9.0
  - @yagejs/core@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [[`62da81f`](https://github.com/marco-lepore/yage/commit/62da81f67076fccaff3a8af6c805dd919c6a687f), [`14fbb16`](https://github.com/marco-lepore/yage/commit/14fbb16ee2bd11adac6a225fa5fccbfb9c2b6758), [`8e2ab0b`](https://github.com/marco-lepore/yage/commit/8e2ab0b301748c2ac5f3d90224d3a2cc92393865), [`face78b`](https://github.com/marco-lepore/yage/commit/face78ba63f9ef6eb52d8a677fc1d8b1457212e6), [`555a868`](https://github.com/marco-lepore/yage/commit/555a86888ec3aedca42587fab7eb3ec5f0c6eeb8), [`4627c80`](https://github.com/marco-lepore/yage/commit/4627c80e409226ff58c2214c2e1bb76e9e1d769f), [`3991288`](https://github.com/marco-lepore/yage/commit/39912883cf191cd065ef0b5779f1b65b53bcbea8), [`23e357f`](https://github.com/marco-lepore/yage/commit/23e357f605957cc24e58ec2e504a82d4ebdcc9a0)]:
  - @yagejs/core@0.8.0
  - @yagejs/debug@0.8.0

## 0.7.0

### Minor Changes

- [#69](https://github.com/marco-lepore/yage/pull/69) [`90e4d30`](https://github.com/marco-lepore/yage/commit/90e4d3064d9c2804549d62844067cf487d592f0a) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Dev-mode warnings for common silent-failure modes:
  - `Component.use(Key)` now throws a named error when called at field-init
    time (before the component is bound to an entity), pointing at
    `this.service(Key)` as the lazy alternative.
  - `ColliderComponent.onCollision` on a sensor collider (or `onTrigger` on a
    non-sensor) emits a one-shot dev warning.
  - Asymmetric collision-mask pairs (where Rapier silently drops events) emit
    a one-shot dev warning per `(layers, mask)` tuple.
  - Declaring a scene layer named `"ui"` without `space: "screen"` warns that
    the auto-provisioned UI layer is being shadowed by a world-space layer.
  - A polygon collider whose convex hull drops vertices (concave input) warns
    so the developer can decompose or switch to a polyline.

  All warnings gate on `process.env.NODE_ENV !== "production"` via a new
  `isDev()` / `devWarn()` helper exported from `@yagejs/core` (`@internal`).

- [#68](https://github.com/marco-lepore/yage/pull/68) [`903b2b9`](https://github.com/marco-lepore/yage/commit/903b2b9539015e8109f0bb456ba75811ad8fba4f) Thanks [@marco-lepore](https://github.com/marco-lepore)! - feat(tilemap): capsule/ellipse + concave-polygon collider support

  **Tiled shape coverage.** `extractCollisionShapes` / `toPhysicsColliders`
  now branch on the `ellipse` and `capsule` flags Tiled writes on object
  instances; previously those silently fell through to the default
  rectangle path and produced wrong AABB hitboxes. Ellipses become
  `circle` colliders (with a dev-warning fallback when `width !== height`,
  since Rapier has no real ellipse primitive); capsule objects become
  `capsule` colliders oriented along the longer axis.

  **Concave polygons via polyline.** Tiled polygons are authored as
  outlines, not solid hulls, so `toPhysicsColliders` now emits them as
  the new `shape: "polyline"` variant (chain of line segments). Unlike
  `shape: "polygon"`, polylines preserve concave detail — at the cost of
  being static-only (no inertia computed). The existing convex `polygon`
  path now logs a dev warning when the input vertex list is concave, so
  the silent convex-hull widening can't return.

  **Breaking — `TilemapColliderConfig` types.** `extractCollisionShapes`
  previously returned `RectColliderConfig | PolygonColliderConfig`; it
  now also returns `CircleColliderConfig`, `CapsuleColliderConfig`, and
  `PolylineColliderConfig` (and Tiled polygons map to `polyline` rather
  than `polygon`). Code that exhaustively switches on the `type` field
  needs new arms for `"circle"`, `"capsule"`, `"polyline"`, and should
  treat the existing `"polygon"` case as covering only pre-converted
  convex hull data.

  **Breaking — `ColliderShape` adds `polyline` + `axis`.** The physics
  `ColliderShape` discriminated union gains a `polyline` variant and the
  `capsule` variant gains an optional `axis: "x" | "y"` field (default
  `"y"`, matching previous behavior).

### Patch Changes

- [#67](https://github.com/marco-lepore/yage/pull/67) [`a6dda59`](https://github.com/marco-lepore/yage/commit/a6dda59d9328666980c17c937f1ec7bd023efc40) Thanks [@marco-lepore](https://github.com/marco-lepore)! - `PhysicsDebugContributor` now draws convex polygon colliders.

  The wireframe pass only handled `Ball`, `Cuboid`, and `Capsule` — polygon shapes (from `{ type: "polygon", vertices }`) silently rendered as nothing. The contributor now switches on `ShapeType.ConvexPolygon` and traces the hull via `collider.vertices()`, closing the path, using the same per-body-type color + alpha scheme as the other shapes.

- Updated dependencies [[`069d41e`](https://github.com/marco-lepore/yage/commit/069d41e711aeb6218c1438f52a2b098ff8946526), [`90e4d30`](https://github.com/marco-lepore/yage/commit/90e4d3064d9c2804549d62844067cf487d592f0a), [`57a6441`](https://github.com/marco-lepore/yage/commit/57a6441f9ef8b5f7140959d6393930c2326d70e0), [`a6dda59`](https://github.com/marco-lepore/yage/commit/a6dda59d9328666980c17c937f1ec7bd023efc40), [`7ca5050`](https://github.com/marco-lepore/yage/commit/7ca5050d91479121039af5e4898fc0c220e8d7c3)]:
  - @yagejs/core@0.7.0
  - @yagejs/debug@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [[`1126143`](https://github.com/marco-lepore/yage/commit/11261436719fed28472cec3143281632f082add5), [`fe4aabc`](https://github.com/marco-lepore/yage/commit/fe4aabcf25525d078e584ab96e69dd907d96bc7c)]:
  - @yagejs/core@0.6.0
  - @yagejs/debug@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [[`cf617fe`](https://github.com/marco-lepore/yage/commit/cf617fe0f28db6ea1a5af7992b76dc19eec8cd0c), [`cf617fe`](https://github.com/marco-lepore/yage/commit/cf617fe0f28db6ea1a5af7992b76dc19eec8cd0c), [`bc3790d`](https://github.com/marco-lepore/yage/commit/bc3790dc4c31c42c4821cd275a9376a0830bb0db), [`d998fc1`](https://github.com/marco-lepore/yage/commit/d998fc16746ee56ff3cad22a5fdf77b2ac19800b), [`114d246`](https://github.com/marco-lepore/yage/commit/114d246820a88e68841a4f9cec2167c188269970)]:
  - @yagejs/debug@0.5.0
  - @yagejs/core@0.5.0

## 0.4.0

### Minor Changes

- [#45](https://github.com/marco-lepore/yage/pull/45) [`0711684`](https://github.com/marco-lepore/yage/commit/0711684b642da76cd29bf250eccc646d89360805) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Inspector deterministic test mode and per-package serialization plumbing for `Inspector.snapshot()`.
  - `PhysicsWorld.snapshot()` returns a stable, sorted view of every rigid body (`entityId`, `type`, `position` and `linvel` in pixel units, `rotation` in radians, `angvel` in rad/s) plus the active contact pairs. Consumed by `Inspector.snapshot()` to record the full physics state per scene.

### Patch Changes

- Updated dependencies [[`0711684`](https://github.com/marco-lepore/yage/commit/0711684b642da76cd29bf250eccc646d89360805), [`0711684`](https://github.com/marco-lepore/yage/commit/0711684b642da76cd29bf250eccc646d89360805)]:
  - @yagejs/core@0.4.0
  - @yagejs/debug@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [[`69f8449`](https://github.com/marco-lepore/yage/commit/69f844942d1596228a6ed50a37ec8e6f1d821353), [`60d2067`](https://github.com/marco-lepore/yage/commit/60d20671e31230f5fcef127203efb127bdfedf92), [`b3ed554`](https://github.com/marco-lepore/yage/commit/b3ed554e7cc60c1583a5379311fbf9e47ec373cb)]:
  - @yagejs/core@0.3.0
  - @yagejs/debug@0.3.0

## 0.2.0

### Minor Changes

- [#20](https://github.com/marco-lepore/yage/pull/20) [`6143e03`](https://github.com/marco-lepore/yage/commit/6143e0346820dd74d78b1d345ac4ebc5e4294769) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add scene-scoped DI and generic scene hooks.
  - New `PhysicsWorldKey` (scene-scoped) is now exported. Components should use `this.use(PhysicsWorldKey)` instead of `this.use(PhysicsWorldManagerKey).getOrCreateWorld(this.scene)`.

### Patch Changes

- Updated dependencies [[`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`32b35dc`](https://github.com/marco-lepore/yage/commit/32b35dcc89b5e28fdb852a08127f0a6f06ded819), [`7c0ced1`](https://github.com/marco-lepore/yage/commit/7c0ced138305b55473b98bf3302ff6a21e8860df), [`fc717ba`](https://github.com/marco-lepore/yage/commit/fc717bac2bc530a2c396da604d614f762d272232), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c)]:
  - @yagejs/debug@0.2.0
  - @yagejs/core@0.2.0
