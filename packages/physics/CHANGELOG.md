# @yagejs/physics

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
