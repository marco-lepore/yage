# @yagejs/particles

## 0.10.3

### Patch Changes

- Updated dependencies [[`3cb9d19`](https://github.com/marco-lepore/yage/commit/3cb9d190e4720816c7ba83a1e6fafd4b05d2684e), [`6dc493e`](https://github.com/marco-lepore/yage/commit/6dc493e32c8a20e928621490c1308f99324e7208), [`d337ce3`](https://github.com/marco-lepore/yage/commit/d337ce3a0a8eddce46117d7ff17eabbb6f2d03b3), [`f106e5d`](https://github.com/marco-lepore/yage/commit/f106e5d3bcc0f8a6a8aa449fee9a0f9c187b4d35), [`6eaad69`](https://github.com/marco-lepore/yage/commit/6eaad6992b0923ec194e3d5e5c3f1eb812afbee8), [`83c9993`](https://github.com/marco-lepore/yage/commit/83c999385c645f158dc3ef7a8cdd995fd9f2b37c), [`31d6435`](https://github.com/marco-lepore/yage/commit/31d6435fd4260363988603fdc2e292478247e314)]:
  - @yagejs/core@0.10.3
  - @yagejs/renderer@0.10.3

## 0.10.2

### Patch Changes

- Updated dependencies [[`97ace87`](https://github.com/marco-lepore/yage/commit/97ace87237bc63accd0b0ffb840e03c51a2bb5b6), [`ef27ea3`](https://github.com/marco-lepore/yage/commit/ef27ea3d1ff31faea4fa77fd6538bd8cadabe606), [`e30b114`](https://github.com/marco-lepore/yage/commit/e30b114d416a211144463540fc6577e6abc6c1e9), [`e30b114`](https://github.com/marco-lepore/yage/commit/e30b114d416a211144463540fc6577e6abc6c1e9), [`7f0b764`](https://github.com/marco-lepore/yage/commit/7f0b76494d72bd94866436ee46a5669c08d60372), [`b29d234`](https://github.com/marco-lepore/yage/commit/b29d2342218cc899a3d286f964bb7876f81ae49d), [`7002ce8`](https://github.com/marco-lepore/yage/commit/7002ce8d35e7a10c384496fcef166884fed5e0b4)]:
  - @yagejs/renderer@0.10.2
  - @yagejs/core@0.10.2

## 0.10.1

### Patch Changes

- Updated dependencies [[`d3a730b`](https://github.com/marco-lepore/yage/commit/d3a730b1dfae45338a53ddcc1267ae3e4102a34a), [`ccc0d71`](https://github.com/marco-lepore/yage/commit/ccc0d71c7f1ae4197b56a5469f61ae4145045391), [`50cc882`](https://github.com/marco-lepore/yage/commit/50cc8825c4365165a5ebfafbb6353c26660daa23)]:
  - @yagejs/core@0.10.1
  - @yagejs/renderer@0.10.1

## 0.10.0

### Minor Changes

- [#214](https://github.com/marco-lepore/yage/pull/214) [`042755b`](https://github.com/marco-lepore/yage/commit/042755b5649a90e99c8840747349255fbb3f95be) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Entities can now be turned off and reused instead of destroyed and respawned: `entity.setActive(false)` puts an entity and its whole subtree to sleep, and components get `onEnable` / `onDisable` to release and reacquire live resources.
  - `ParticleEmitterComponent` hides its particle container while the entity is dormant. Emission stops because the emitter leaves `ParticleSystem`'s query, and the pooled particles are kept, so the effect picks up mid-flight on reactivation. A container you hid yourself stays hidden when the entity comes back.

- [#222](https://github.com/marco-lepore/yage/pull/222) [`5177383`](https://github.com/marco-lepore/yage/commit/5177383999bb10bb9d19deaa622005eef7f00b39) Thanks [@marco-lepore](https://github.com/marco-lepore)! - `ParticleEmitterComponent` accepts a `blendMode` option, matching the renderer's visual components. Additive fire and sparks no longer need a reach into `emitter.container`:

  ```ts
  const emitter = new ParticleEmitterComponent({
    ...ParticlePresets.fire(),
    blendMode: "add",
  });

  emitter.blendMode = "normal"; // also a live accessor
  ```

  The mode applies to the emitter's container, so all of its particles blend the same way. It is saved and restored with the rest of the emitter config.

- [#211](https://github.com/marco-lepore/yage/pull/211) [`f24a8c2`](https://github.com/marco-lepore/yage/commit/f24a8c2b57170e38940c86486e423c9f3d62dfe8) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Particles work without any texture asset. A new `shape` option on `EmitterConfig` picks one of six built-in white shapes, and `texture`/`textureKey` are no longer required.
  - `new ParticleEmitterComponent({ lifetime: 1 })` renders 1×1 white particles. Set `tint` to color them and `scale` to size them.
  - `shape?: ParticleShape | ShapeConfig` — `"pixel" | "circle" | "softCircle" | "diamond" | "softDiamond" | "line"`. The `soft*` variants fade from an opaque centre to a transparent edge, with `softDiamond` reading as a four-point sparkle.
  - `ShapeConfig` gives the shape an explicit texture size: `{ type: "softCircle", size: 16 }` for a square, `{ type: "circle", size: [32, 16] }` for an ellipse, `{ type: "line", size: [4, 32] }` for a vertical streak. Default size is 64×64, `"line"` 64×8, `"pixel"` 1×1. No shape forces an aspect ratio. `size` is the generated texture's size in pixels, which at the default `scale: 1` is also the on-screen size — use a few fixed values and vary per-particle size with `scale`. A size must be a finite number above 0; anything else throws instead of producing an empty texture.
  - `texture`, `textureKey` and `shape` are mutually exclusive: setting more than one is a type error. Passing several from plain JavaScript still resolves in that order.
  - `shapeTexture(shape)` is exported for direct use. Each type and size pair is generated on first request and shared by every emitter asking for it — do not destroy the texture it returns. A 1×1 `"pixel"` is `Texture.WHITE` and generates nothing.
  - Every shape is visible at every size, down to 1×1. `"pixel"` and `"line"` fill their texture edge to edge. The other four draw their outline inside the texture with a one-pixel antialiased edge, and fill their texture instead once they are too thin to hold one — at 3 pixels or less on either axis, that border would be the whole shape.
  - Shape generation writes an RGBA buffer, so it runs in headless tests and needs no DOM, canvas, or renderer.
  - A snapshot carries the emitter's asset key or its `shape: { type, size }`, never both, so shape emitters save and restore like texture ones. The key comes from whichever source actually rendered: an emitter built from a raw `Texture` object serializes as `null` with a warning even if a `textureKey` was passed alongside it.

  Every `ParticlePresets` factory now takes its texture as an _optional_ argument and falls back to a built-in shape, so `ParticlePresets.fire()` is a complete effect with no art.
  - `fire(textureOrKey?)`, `smoke(textureOrKey?)`, `sparks(textureOrKey?)`, `rain(textureOrKey?)`. Existing call sites that pass a texture are unaffected.
  - Default shapes: `fire` a 32px `softCircle`, `smoke` a 40px one, `sparks` a 10×3 `line`, `rain` a 2×20 `line`.
  - Each preset's absolute particle size moved into that shape's `size`, leaving its `scale` as lifetime animation and per-particle variation centred on 1. A caller-supplied texture is therefore animated at its natural size instead of scaled against an assumed one. Preset emission rates, speeds and lifetimes were retuned to match.
  - Because a preset config already carries a texture source and the three sources are mutually exclusive, overriding the source by spreading (`{ ...ParticlePresets.fire(), texture: myTex }`) is a type error. Pass it as the argument instead. Spreading to override anything else still works.

- [#211](https://github.com/marco-lepore/yage/pull/211) [`f24a8c2`](https://github.com/marco-lepore/yage/commit/f24a8c2b57170e38940c86486e423c9f3d62dfe8) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Emitters spawn particles centred on their entity's world position.
  - `burst(count)` without coordinates spawns at the entity's `Transform.worldPosition` instead of the world origin. `burst` now takes either no position or both coordinates — `burst(count, x)` is a type error rather than an x with an implied y of 0.
  - Continuous emission reads `Transform.worldPosition` rather than the local `position`, so an emitter parented to another entity — a muzzle flash on a gun, a thruster on a ship — emits where it is drawn.
  - Particles are anchored at their middle, so one is drawn centred on its spawn point and `rotationSpeed` turns it about its own centre. This changes how existing emitters look: a particle used to hang down and to the right of the spawn point by half its size, and spin about its top-left corner. It applies to your own textures as well as to built-in shapes.
  - `ParticleEmitterComponent` requires a `Transform` on the same entity, and warns once on the first `emit()` or `burst()` if there is none. `ParticleSystem` queries for both, so such an emitter never emits and never ages the particles a `burst` already spawned.

### Patch Changes

- Updated dependencies [[`34d45fd`](https://github.com/marco-lepore/yage/commit/34d45fd690d747b7d8dd36a5972ef20d21d574da), [`f48983d`](https://github.com/marco-lepore/yage/commit/f48983dbb4e43c25b455ac3f96e7d8684266bbc3), [`f48983d`](https://github.com/marco-lepore/yage/commit/f48983dbb4e43c25b455ac3f96e7d8684266bbc3), [`042755b`](https://github.com/marco-lepore/yage/commit/042755b5649a90e99c8840747349255fbb3f95be), [`042755b`](https://github.com/marco-lepore/yage/commit/042755b5649a90e99c8840747349255fbb3f95be), [`f1048ab`](https://github.com/marco-lepore/yage/commit/f1048ab756feee84e593609521c3a58fcfc1c1a7), [`4a5b3b6`](https://github.com/marco-lepore/yage/commit/4a5b3b639ddcbb285b6a4733b89d27bcee14c50c), [`d459026`](https://github.com/marco-lepore/yage/commit/d4590265b9aa5297fb99d20b92bb5a2f19cac0c5), [`8400b55`](https://github.com/marco-lepore/yage/commit/8400b5519cb3401a0ad91ab1be511e3d885cc203), [`81eafe0`](https://github.com/marco-lepore/yage/commit/81eafe04c3b362832e2dc873bea996f36f4601fd)]:
  - @yagejs/core@0.10.0
  - @yagejs/renderer@0.10.0

## 0.9.0

### Minor Changes

- [#159](https://github.com/marco-lepore/yage/pull/159) [`9b637bc`](https://github.com/marco-lepore/yage/commit/9b637bcd832476a6c47eb4dacb8cf33e9c5139b0) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Change the engine time unit from milliseconds to seconds.

  `Component.update(dt)` / `fixedUpdate(dt)` now receive seconds (~0.0167 at 60fps) instead of milliseconds. `EngineConfig.fixedTimestep` defaults to `1/60` and is expressed in seconds. All duration-based APIs follow: `Process.delay`, `ProcessSlot`/`ProcessComponent.slot` durations, `Tween`/`Sequence.wait`/`Tween.stagger` step, `KeyframeTrack` keyframe `time`, `LoadingScene.minDuration`, scene-transition durations (`fade`/`flash`/`crossFade`/`iris`/`irisReveal`/`chessboard`/`slidePush`), `CameraComponent.shake`/`zoomTo`, `AnimationController.playOneShot`, and effect durations/fades (`hitFlash`, `shockwave`, `fadeIn`/`fadeOut`) are all in seconds.

  Migration: drop any `dt / 1000` conversion in your `update`/`fixedUpdate` code, and pass durations in seconds (e.g. `300` ms becomes `0.3`).

- [#178](https://github.com/marco-lepore/yage/pull/178) [`82db867`](https://github.com/marco-lepore/yage/commit/82db867c0176208d5968ae3aa68296db3d724955) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Unify the five visual components' options, delete the raw-texture escape
  hatches, and stop leaking raw `pixi.js` types from public signatures.
  - `ParticleEmitterComponent.container` is now typed as
    `@yagejs/renderer`'s `ParticleContainer` alias instead of a raw
    `pixi.js` import, and `ParticlePool.acquire()`/`release()` use the new
    `Particle` alias. Type-only change — the values are still the real Pixi
    objects.

### Patch Changes

- [#192](https://github.com/marco-lepore/yage/pull/192) [`f6c2fa8`](https://github.com/marco-lepore/yage/commit/f6c2fa8e508620fb5356b8e4481a199115a73a45) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Snapshot restore order is now driven by a `restorePriority` static on each component class.
  - `ParticleEmitterComponent` declares priority 50, keeping it inside the engine band so it restores before undeclared game components.

- [#189](https://github.com/marco-lepore/yage/pull/189) [`8a933db`](https://github.com/marco-lepore/yage/commit/8a933db95eedb908ad98e95631d5022fe1e0ef28) Thanks [@marco-lepore](https://github.com/marco-lepore)! - `SceneTime`: per-scene arbitration for time effects — hitstop, slow motion, bullet time, freeze frames.
  - `ParticleSystem` drives emitters under the per-entity `SceneTime.effectiveScaleForUpdates(entity)`, so freezes and slows affect particles and `excludeUpdates` keeps excluded entities' emitters at full speed.

- Updated dependencies [[`a5c8be9`](https://github.com/marco-lepore/yage/commit/a5c8be9527ce31a5a8f0ce6b6d94a830d2322c83), [`c62453b`](https://github.com/marco-lepore/yage/commit/c62453b48a5f5dbebdb26c6bab495cc7d5b64195), [`0574e44`](https://github.com/marco-lepore/yage/commit/0574e44d68df2568c57d0275aff139bddebb06da), [`3f7a367`](https://github.com/marco-lepore/yage/commit/3f7a367edc5af8d0d78e6e95bcc709bd8b77d783), [`a5d7d53`](https://github.com/marco-lepore/yage/commit/a5d7d5370fb8db567f4ceb39934574ab5c37a174), [`22c05c8`](https://github.com/marco-lepore/yage/commit/22c05c8a561d6361ca3489eaa2d0a0ea5caf2492), [`22f8534`](https://github.com/marco-lepore/yage/commit/22f8534e8dbc9ef054c23a570ab851f8710db68f), [`da97f10`](https://github.com/marco-lepore/yage/commit/da97f10ba7cb7627f48efccf3bfe1836bfac3dbc), [`f6c2fa8`](https://github.com/marco-lepore/yage/commit/f6c2fa8e508620fb5356b8e4481a199115a73a45), [`f6c2fa8`](https://github.com/marco-lepore/yage/commit/f6c2fa8e508620fb5356b8e4481a199115a73a45), [`10d3ac5`](https://github.com/marco-lepore/yage/commit/10d3ac5ec3f3dca593f35728b175df3bfd073bb6), [`8a933db`](https://github.com/marco-lepore/yage/commit/8a933db95eedb908ad98e95631d5022fe1e0ef28), [`9b637bc`](https://github.com/marco-lepore/yage/commit/9b637bcd832476a6c47eb4dacb8cf33e9c5139b0), [`3fbbe3d`](https://github.com/marco-lepore/yage/commit/3fbbe3d3c936f636d5069e296a4ca228b7511c86), [`9b02d02`](https://github.com/marco-lepore/yage/commit/9b02d024fe54ea30efef01a109387b839266b791), [`8156b6d`](https://github.com/marco-lepore/yage/commit/8156b6dcc8429b738c3efeb949fafd1cce245330), [`8d061c5`](https://github.com/marco-lepore/yage/commit/8d061c54eb0bbf3aed75b2b943fef1affdce7667), [`0735a9a`](https://github.com/marco-lepore/yage/commit/0735a9a3a1fa6e3f7b8549887b9b87d43674df98), [`82db867`](https://github.com/marco-lepore/yage/commit/82db867c0176208d5968ae3aa68296db3d724955)]:
  - @yagejs/renderer@0.9.0
  - @yagejs/core@0.9.0

## 0.8.0

### Minor Changes

- [#112](https://github.com/marco-lepore/yage/pull/112) [`8e2ab0b`](https://github.com/marco-lepore/yage/commit/8e2ab0b301748c2ac5f3d90224d3a2cc92393865) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add a per-entity `timeScale` multiplier (closes [#92](https://github.com/marco-lepore/yage/issues/92)).
  - `Entity.timeScale` (default `1`) scales the delta time the engine feeds an
    entity's components: `dt * scene.timeScale * entity.timeScale`. It composes
    on top of the scene's `timeScale`, so `0` freezes a single entity while the
    scene keeps running and `2` runs it at double speed.
  - Applies to component `update()` / `fixedUpdate()`
    (`ComponentUpdateSystem`), the entity's `ProcessComponent` tween tick
    (`ProcessSystem` — scene-scoped processes stay scene-only), and the entity's
    particle emitters (`ParticleSystem`).
  - Physics is deliberately carved out: a scene shares one Rapier world stepped
    once per (scene-scaled) fixed tick, so a rigid body cannot be individually
    time-scaled. Use `scene.timeScale`, a kinematic body, or manual velocity
    scaling for per-body time control.
  - `entity.timeScale` is captured and restored by the save snapshot (omitted
    from the snapshot when left at the default to keep saves compact).

### Patch Changes

- Updated dependencies [[`62da81f`](https://github.com/marco-lepore/yage/commit/62da81f67076fccaff3a8af6c805dd919c6a687f), [`62da81f`](https://github.com/marco-lepore/yage/commit/62da81f67076fccaff3a8af6c805dd919c6a687f), [`cc29414`](https://github.com/marco-lepore/yage/commit/cc29414877a074688a411d93f7ecf6781ca82ea2), [`2982d21`](https://github.com/marco-lepore/yage/commit/2982d21facc865261e258ee02dc6b8000f226e9f), [`8e2ab0b`](https://github.com/marco-lepore/yage/commit/8e2ab0b301748c2ac5f3d90224d3a2cc92393865), [`face78b`](https://github.com/marco-lepore/yage/commit/face78ba63f9ef6eb52d8a677fc1d8b1457212e6), [`555a868`](https://github.com/marco-lepore/yage/commit/555a86888ec3aedca42587fab7eb3ec5f0c6eeb8), [`664748f`](https://github.com/marco-lepore/yage/commit/664748fdf3c6a9527981746d0c5bd2528db4402d), [`664748f`](https://github.com/marco-lepore/yage/commit/664748fdf3c6a9527981746d0c5bd2528db4402d), [`4627c80`](https://github.com/marco-lepore/yage/commit/4627c80e409226ff58c2214c2e1bb76e9e1d769f), [`cafa74c`](https://github.com/marco-lepore/yage/commit/cafa74cbe90ec1143c60dcfd782a0a76c8d859dd), [`3991288`](https://github.com/marco-lepore/yage/commit/39912883cf191cd065ef0b5779f1b65b53bcbea8), [`23e357f`](https://github.com/marco-lepore/yage/commit/23e357f605957cc24e58ec2e504a82d4ebdcc9a0), [`68e7243`](https://github.com/marco-lepore/yage/commit/68e72436209f7e03f0e8ad0bde94f3d23562bcbe)]:
  - @yagejs/core@0.8.0
  - @yagejs/renderer@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [[`a6dda59`](https://github.com/marco-lepore/yage/commit/a6dda59d9328666980c17c937f1ec7bd023efc40), [`8d80f18`](https://github.com/marco-lepore/yage/commit/8d80f1856ac897e8dcaa28543d57ff16750e97f3), [`069d41e`](https://github.com/marco-lepore/yage/commit/069d41e711aeb6218c1438f52a2b098ff8946526), [`90e4d30`](https://github.com/marco-lepore/yage/commit/90e4d3064d9c2804549d62844067cf487d592f0a), [`a6dda59`](https://github.com/marco-lepore/yage/commit/a6dda59d9328666980c17c937f1ec7bd023efc40), [`57a6441`](https://github.com/marco-lepore/yage/commit/57a6441f9ef8b5f7140959d6393930c2326d70e0), [`0e9f86c`](https://github.com/marco-lepore/yage/commit/0e9f86cc42bb632d38a67c22aa31b6dd21cf82e7), [`a6dda59`](https://github.com/marco-lepore/yage/commit/a6dda59d9328666980c17c937f1ec7bd023efc40), [`7ca5050`](https://github.com/marco-lepore/yage/commit/7ca5050d91479121039af5e4898fc0c220e8d7c3)]:
  - @yagejs/renderer@0.7.0
  - @yagejs/core@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [[`cd26383`](https://github.com/marco-lepore/yage/commit/cd2638345e54709a2a5281334dc71448de64f4cf), [`47ffab6`](https://github.com/marco-lepore/yage/commit/47ffab6b37423155f92e97519b66b73e14b73039), [`9a2519b`](https://github.com/marco-lepore/yage/commit/9a2519ba9ed739cacc116699fc2944eb54930e23), [`cd26383`](https://github.com/marco-lepore/yage/commit/cd2638345e54709a2a5281334dc71448de64f4cf), [`1126143`](https://github.com/marco-lepore/yage/commit/11261436719fed28472cec3143281632f082add5), [`d9be1b3`](https://github.com/marco-lepore/yage/commit/d9be1b365ae83a8ca365d72003ec23e6fbb8679f), [`fe4aabc`](https://github.com/marco-lepore/yage/commit/fe4aabcf25525d078e584ab96e69dd907d96bc7c), [`fe4aabc`](https://github.com/marco-lepore/yage/commit/fe4aabcf25525d078e584ab96e69dd907d96bc7c)]:
  - @yagejs/renderer@0.6.0
  - @yagejs/core@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [[`cf617fe`](https://github.com/marco-lepore/yage/commit/cf617fe0f28db6ea1a5af7992b76dc19eec8cd0c), [`bc3790d`](https://github.com/marco-lepore/yage/commit/bc3790dc4c31c42c4821cd275a9376a0830bb0db), [`d998fc1`](https://github.com/marco-lepore/yage/commit/d998fc16746ee56ff3cad22a5fdf77b2ac19800b), [`d998fc1`](https://github.com/marco-lepore/yage/commit/d998fc16746ee56ff3cad22a5fdf77b2ac19800b), [`114d246`](https://github.com/marco-lepore/yage/commit/114d246820a88e68841a4f9cec2167c188269970)]:
  - @yagejs/renderer@0.5.0
  - @yagejs/core@0.5.0

## 0.4.0

### Minor Changes

- [#45](https://github.com/marco-lepore/yage/pull/45) [`0711684`](https://github.com/marco-lepore/yage/commit/0711684b642da76cd29bf250eccc646d89360805) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Inspector deterministic test mode and per-package serialization plumbing for `Inspector.snapshot()`.
  - `ParticleEmitterComponent` resolves `RandomKey` from the scene and threads it through every `resolveRange(...)` call site (spawn offsets, speed, angle, rotation, scale, lifetime). With a seeded inspector, particle bursts are bit-identical across replays.

### Patch Changes

- Updated dependencies [[`e7d6645`](https://github.com/marco-lepore/yage/commit/e7d6645f9acff27269fa6f6e52032482651b146d), [`0711684`](https://github.com/marco-lepore/yage/commit/0711684b642da76cd29bf250eccc646d89360805), [`0711684`](https://github.com/marco-lepore/yage/commit/0711684b642da76cd29bf250eccc646d89360805), [`08efa94`](https://github.com/marco-lepore/yage/commit/08efa94a8be02ba56c1df9d3bed643abcc1d7159)]:
  - @yagejs/renderer@0.4.0
  - @yagejs/core@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [[`69f8449`](https://github.com/marco-lepore/yage/commit/69f844942d1596228a6ed50a37ec8e6f1d821353), [`c5e2656`](https://github.com/marco-lepore/yage/commit/c5e2656bd3dab4020a303e34dd77ccbd60ef4ca4), [`60d2067`](https://github.com/marco-lepore/yage/commit/60d20671e31230f5fcef127203efb127bdfedf92), [`b3ed554`](https://github.com/marco-lepore/yage/commit/b3ed554e7cc60c1583a5379311fbf9e47ec373cb), [`b3ed554`](https://github.com/marco-lepore/yage/commit/b3ed554e7cc60c1583a5379311fbf9e47ec373cb), [`c5e2656`](https://github.com/marco-lepore/yage/commit/c5e2656bd3dab4020a303e34dd77ccbd60ef4ca4)]:
  - @yagejs/core@0.3.0
  - @yagejs/renderer@0.3.0

## 0.2.0

### Patch Changes

- [#29](https://github.com/marco-lepore/yage/pull/29) [`7c0ced1`](https://github.com/marco-lepore/yage/commit/7c0ced138305b55473b98bf3302ff6a21e8860df) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Migrate `ParticleSystem`'s defensive `entity.scene` null check to the new `entity.tryScene` introduced in `@yagejs/core`. No behavior change.

- [#20](https://github.com/marco-lepore/yage/pull/20) [`6143e03`](https://github.com/marco-lepore/yage/commit/6143e0346820dd74d78b1d345ac4ebc5e4294769) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Adopt scene-scoped DI.
  - `ParticleEmitterComponent` resolves its layer through `SceneRenderTreeKey` (scene-scoped) instead of the removed `RenderLayerManagerKey`.

- Updated dependencies [[`233aed2`](https://github.com/marco-lepore/yage/commit/233aed24dcd68e020a20a030d13668224ce22c4b), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`7c0ced1`](https://github.com/marco-lepore/yage/commit/7c0ced138305b55473b98bf3302ff6a21e8860df), [`7c0ced1`](https://github.com/marco-lepore/yage/commit/7c0ced138305b55473b98bf3302ff6a21e8860df), [`fc717ba`](https://github.com/marco-lepore/yage/commit/fc717bac2bc530a2c396da604d614f762d272232), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c)]:
  - @yagejs/renderer@0.2.0
  - @yagejs/core@0.2.0
