# @yagejs/physics

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
