# @yagejs/debug

## 0.11.0

### Minor Changes

- [#328](https://github.com/marco-lepore/yage/pull/328) [`05492cb`](https://github.com/marco-lepore/yage/commit/05492cb8e27f89fe82fedd6e307afa2f90d1f68f) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Keep diagnostic frames, clock control, and scene state consistent.
  - Use `Inspector.time` for public clock control. Remove the global `clock` slot, its public type, and the separate debug frame counter.
  - Add `WorldDebugApi.forScene(scene)` so vectors and custom diagnostics follow each visible scene's effective camera. Share one graphics limit across all scenes and release drawing resources on scene exit.
  - Attribute contributor failures to their name and callback method before propagating the error.

### Patch Changes

- [#304](https://github.com/marco-lepore/yage/pull/304) [`daa8214`](https://github.com/marco-lepore/yage/commit/daa821458a69d14176f5c5aebc3f4204348ddb0c) Thanks [@marco-lepore](https://github.com/marco-lepore)! - The overlay's entity counter reads `inspector.getEntityCount()` instead of
  building a full world snapshot every frame.

- [#329](https://github.com/marco-lepore/yage/pull/329) [`8d7b5e3`](https://github.com/marco-lepore/yage/commit/8d7b5e3fe395898c7f4cbde0b352acc2713e6559) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add caller-owned vector buffers and coordinate reads without Vec2 construction.
  - Reuse Transform coordinate buffers when positioning registered debug vectors.

- Updated dependencies [[`d2adfed`](https://github.com/marco-lepore/yage/commit/d2adfedb0e5d15269fe941a3a24f23ddb0126aa4), [`dc42ba4`](https://github.com/marco-lepore/yage/commit/dc42ba40cd3bbd04c8ff27bf4e8721f274dde034), [`dc42ba4`](https://github.com/marco-lepore/yage/commit/dc42ba40cd3bbd04c8ff27bf4e8721f274dde034), [`daa8214`](https://github.com/marco-lepore/yage/commit/daa821458a69d14176f5c5aebc3f4204348ddb0c), [`daa8214`](https://github.com/marco-lepore/yage/commit/daa821458a69d14176f5c5aebc3f4204348ddb0c), [`c105024`](https://github.com/marco-lepore/yage/commit/c105024b5402c11dc36da52b08f6ab39354da8a5), [`c8ad215`](https://github.com/marco-lepore/yage/commit/c8ad215530681caeb63484cc07b118cd977a5ba5), [`08b0d06`](https://github.com/marco-lepore/yage/commit/08b0d06b63a44a51bd6f8e8308574fd41c96af59), [`08b0d06`](https://github.com/marco-lepore/yage/commit/08b0d06b63a44a51bd6f8e8308574fd41c96af59), [`33d00e3`](https://github.com/marco-lepore/yage/commit/33d00e37801a300710cc10de0352b1aa1b1ba2f1), [`7275620`](https://github.com/marco-lepore/yage/commit/7275620756183b22de3df1009e1e07615db9b40e), [`4bab66f`](https://github.com/marco-lepore/yage/commit/4bab66f0e34a387155bbc7168b048dcac167525f), [`cfde97d`](https://github.com/marco-lepore/yage/commit/cfde97de2c94416cb5bbab26a12f9c290e6b66cf), [`9b9fe07`](https://github.com/marco-lepore/yage/commit/9b9fe07d7f32219c0e9aa37265b526cdc5924ce8), [`9e194ec`](https://github.com/marco-lepore/yage/commit/9e194ec386a74c0f1ad5699c3c0db183aa86f1b1), [`9e194ec`](https://github.com/marco-lepore/yage/commit/9e194ec386a74c0f1ad5699c3c0db183aa86f1b1), [`05492cb`](https://github.com/marco-lepore/yage/commit/05492cb8e27f89fe82fedd6e307afa2f90d1f68f), [`05492cb`](https://github.com/marco-lepore/yage/commit/05492cb8e27f89fe82fedd6e307afa2f90d1f68f), [`aed53f7`](https://github.com/marco-lepore/yage/commit/aed53f7f5679f824846dee3c55c0342f7f07cf98), [`ba57361`](https://github.com/marco-lepore/yage/commit/ba5736175e8b3e06157e680b4b66d10eb8d06823), [`aa5b78e`](https://github.com/marco-lepore/yage/commit/aa5b78e18b56d17bdca4ffb8299c8ea83979e05a), [`439d0e2`](https://github.com/marco-lepore/yage/commit/439d0e205228bee15d8d79607abdba5731b0873b), [`aaf1279`](https://github.com/marco-lepore/yage/commit/aaf1279455bc655681cf15c8edc64b1407b2a823), [`8064fa6`](https://github.com/marco-lepore/yage/commit/8064fa64099feeb1d164360b668e0721a14b7bbe), [`8064fa6`](https://github.com/marco-lepore/yage/commit/8064fa64099feeb1d164360b668e0721a14b7bbe), [`8f11936`](https://github.com/marco-lepore/yage/commit/8f119362281bf31ab59b8b907816886922aaf18f), [`b087462`](https://github.com/marco-lepore/yage/commit/b087462ab2ae27bebb7ce274402c9e278f6d472a), [`8bb9e0b`](https://github.com/marco-lepore/yage/commit/8bb9e0b905017ac724f70fc8fe55014605563e88), [`8d7b5e3`](https://github.com/marco-lepore/yage/commit/8d7b5e3fe395898c7f4cbde0b352acc2713e6559), [`8d7b5e3`](https://github.com/marco-lepore/yage/commit/8d7b5e3fe395898c7f4cbde0b352acc2713e6559), [`b64cd45`](https://github.com/marco-lepore/yage/commit/b64cd453a65a83899b9e8d5fecf4ad43bf1eb3d4), [`ff52a8a`](https://github.com/marco-lepore/yage/commit/ff52a8a4816b18f7de5309ab08606183db67e071)]:
  - @yagejs/renderer@0.11.0
  - @yagejs/core@0.11.0

## 0.10.4

### Patch Changes

- [#285](https://github.com/marco-lepore/yage/pull/285) [`383b8e7`](https://github.com/marco-lepore/yage/commit/383b8e710d6eb3c673e52b5a1386478dfafa2bea) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add `drawVector` — a per-entity arrow for a vector read fresh every frame

  `DebugRegistry.drawVector(entity, () => vector, options?)` draws an arrow on an
  entity for a velocity, aim direction, knockback, or steering output, replacing
  the hand-rolled `GraphicsComponent` that clears and redraws a line every update.
  Options cover `scale`, `color`, `alpha`, `origin`, `minLength`, `width` and
  `headSize`; shaft width and head size divide by the camera zoom so they keep a
  constant on-screen size, while the arrow's length stays in world pixels.

  The call returns a disposer, and a registration is dropped when the entity's
  life ends — destroyed, or a pool member whose lease ended — so a provider
  closure never outlives the entity it draws for and a per-lease registration
  never accumulates. The provider is read only while the overlay is on and the
  new `vectors` contributor's `arrows` flag is enabled, so a `drawVector` call in
  a hot path costs nothing with debug off. Resolve the registry with
  `tryResolve` rather than `use` in code that has to run without `DebugPlugin`
  installed.

  A hand-written `DebugRegistry` stub, such as one standing in for the registry in
  a plugin's tests, needs a `drawVector` entry to satisfy the interface.

  The package root now also re-exports the contributor-facing surface —
  `DebugRegistryKey`, `DebugRegistry`, `DebugContributor`, `DebugGraphics`,
  `WorldDebugApi`, `HudDebugApi`, `StatsApi` and the two vector types — matching
  how `@yagejs/renderer`, `@yagejs/physics` and `@yagejs/input` mirror their own
  `./api` entries. `@yagejs/debug/api` is unchanged and stays the import to reach
  for in game code, since it carries the same surface without pulling in pixi.js.

- Updated dependencies [[`7a0d56e`](https://github.com/marco-lepore/yage/commit/7a0d56e3540e246673353b7b6facfeebedb2a51f), [`753050b`](https://github.com/marco-lepore/yage/commit/753050b08270af8a73f694e27ca886613c1b57fa)]:
  - @yagejs/core@0.10.4
  - @yagejs/renderer@0.10.4

## 0.10.3

### Patch Changes

- Updated dependencies [[`3cb9d19`](https://github.com/marco-lepore/yage/commit/3cb9d190e4720816c7ba83a1e6fafd4b05d2684e), [`6dc493e`](https://github.com/marco-lepore/yage/commit/6dc493e32c8a20e928621490c1308f99324e7208), [`d337ce3`](https://github.com/marco-lepore/yage/commit/d337ce3a0a8eddce46117d7ff17eabbb6f2d03b3), [`f106e5d`](https://github.com/marco-lepore/yage/commit/f106e5d3bcc0f8a6a8aa449fee9a0f9c187b4d35), [`6eaad69`](https://github.com/marco-lepore/yage/commit/6eaad6992b0923ec194e3d5e5c3f1eb812afbee8), [`83c9993`](https://github.com/marco-lepore/yage/commit/83c999385c645f158dc3ef7a8cdd995fd9f2b37c), [`31d6435`](https://github.com/marco-lepore/yage/commit/31d6435fd4260363988603fdc2e292478247e314)]:
  - @yagejs/core@0.10.3
  - @yagejs/renderer@0.10.3

## 0.10.2

### Patch Changes

- [#255](https://github.com/marco-lepore/yage/pull/255) [`2785ce9`](https://github.com/marco-lepore/yage/commit/2785ce964623feeb8478301fdb350a1806ee41b4) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Rounded box colliders and contact skins, so a walking body stops catching on terrain polyline junctions.
  - `DebugGraphics` gains `roundRect(x, y, width, height, radius)`, matching the PixiJS method of the same name, so a contributor can outline a rounded shape in one call. The physics overlay uses it to draw rounded box colliders.
  - A hand-written `DebugGraphics` stub, such as one in a custom contributor's tests, needs a `roundRect` entry to satisfy the interface.

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
  - `findTopmostCamera` skips cameras on dormant entities, matching `DisplaySystem`, which reaches cameras through a query and so never sees one.
  - The `getCameraStack` diagnostic reports each camera's effective enabled-ness — its own flag combined with an active entity — rather than the flag alone.

- [#207](https://github.com/marco-lepore/yage/pull/207) [`d459026`](https://github.com/marco-lepore/yage/commit/d4590265b9aa5297fb99d20b92bb5a2f19cac0c5) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Inspector improvements for verifying games headlessly: default component introspection, awaitable stepping, stall detection, and event-log control.
  - Added an `eventLog` option to `DebugPlugin` config (default `true`). Set `eventLog: false` to keep the debug overlay and stats while disabling per-event Inspector event logging.

### Patch Changes

- Updated dependencies [[`34d45fd`](https://github.com/marco-lepore/yage/commit/34d45fd690d747b7d8dd36a5972ef20d21d574da), [`f48983d`](https://github.com/marco-lepore/yage/commit/f48983dbb4e43c25b455ac3f96e7d8684266bbc3), [`f48983d`](https://github.com/marco-lepore/yage/commit/f48983dbb4e43c25b455ac3f96e7d8684266bbc3), [`042755b`](https://github.com/marco-lepore/yage/commit/042755b5649a90e99c8840747349255fbb3f95be), [`042755b`](https://github.com/marco-lepore/yage/commit/042755b5649a90e99c8840747349255fbb3f95be), [`f1048ab`](https://github.com/marco-lepore/yage/commit/f1048ab756feee84e593609521c3a58fcfc1c1a7), [`4a5b3b6`](https://github.com/marco-lepore/yage/commit/4a5b3b639ddcbb285b6a4733b89d27bcee14c50c), [`d459026`](https://github.com/marco-lepore/yage/commit/d4590265b9aa5297fb99d20b92bb5a2f19cac0c5), [`8400b55`](https://github.com/marco-lepore/yage/commit/8400b5519cb3401a0ad91ab1be511e3d885cc203), [`81eafe0`](https://github.com/marco-lepore/yage/commit/81eafe04c3b362832e2dc873bea996f36f4601fd)]:
  - @yagejs/core@0.10.0
  - @yagejs/renderer@0.10.0

## 0.9.0

### Minor Changes

- [#159](https://github.com/marco-lepore/yage/pull/159) [`9b637bc`](https://github.com/marco-lepore/yage/commit/9b637bcd832476a6c47eb4dacb8cf33e9c5139b0) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Change the engine time unit from milliseconds to seconds.

  `Component.update(dt)` / `fixedUpdate(dt)` now receive seconds (~0.0167 at 60fps) instead of milliseconds. `EngineConfig.fixedTimestep` defaults to `1/60` and is expressed in seconds. All duration-based APIs follow: `Process.delay`, `ProcessSlot`/`ProcessComponent.slot` durations, `Tween`/`Sequence.wait`/`Tween.stagger` step, `KeyframeTrack` keyframe `time`, `LoadingScene.minDuration`, scene-transition durations (`fade`/`flash`/`crossFade`/`iris`/`irisReveal`/`chessboard`/`slidePush`), `CameraComponent.shake`/`zoomTo`, `AnimationController.playOneShot`, and effect durations/fades (`hitFlash`, `shockwave`, `fadeIn`/`fadeOut`) are all in seconds.

  Migration: drop any `dt / 1000` conversion in your `update`/`fixedUpdate` code, and pass durations in seconds (e.g. `300` ms becomes `0.3`).

### Patch Changes

- [#168](https://github.com/marco-lepore/yage/pull/168) [`3d7d69e`](https://github.com/marco-lepore/yage/commit/3d7d69ee94ea1dc4db7b2369127cb3b36eb53556) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Tiled collision-shape extraction and physics/debug correctness fixes, plus collider rotation support.
  - Contributor registration no longer resets declared flags to `true`, so `DebugConfig.flags` overrides applied at install survive the built-in contributors registering in `onStart`.

- Updated dependencies [[`a5c8be9`](https://github.com/marco-lepore/yage/commit/a5c8be9527ce31a5a8f0ce6b6d94a830d2322c83), [`c62453b`](https://github.com/marco-lepore/yage/commit/c62453b48a5f5dbebdb26c6bab495cc7d5b64195), [`0574e44`](https://github.com/marco-lepore/yage/commit/0574e44d68df2568c57d0275aff139bddebb06da), [`3f7a367`](https://github.com/marco-lepore/yage/commit/3f7a367edc5af8d0d78e6e95bcc709bd8b77d783), [`a5d7d53`](https://github.com/marco-lepore/yage/commit/a5d7d5370fb8db567f4ceb39934574ab5c37a174), [`22c05c8`](https://github.com/marco-lepore/yage/commit/22c05c8a561d6361ca3489eaa2d0a0ea5caf2492), [`22f8534`](https://github.com/marco-lepore/yage/commit/22f8534e8dbc9ef054c23a570ab851f8710db68f), [`da97f10`](https://github.com/marco-lepore/yage/commit/da97f10ba7cb7627f48efccf3bfe1836bfac3dbc), [`f6c2fa8`](https://github.com/marco-lepore/yage/commit/f6c2fa8e508620fb5356b8e4481a199115a73a45), [`f6c2fa8`](https://github.com/marco-lepore/yage/commit/f6c2fa8e508620fb5356b8e4481a199115a73a45), [`10d3ac5`](https://github.com/marco-lepore/yage/commit/10d3ac5ec3f3dca593f35728b175df3bfd073bb6), [`8a933db`](https://github.com/marco-lepore/yage/commit/8a933db95eedb908ad98e95631d5022fe1e0ef28), [`9b637bc`](https://github.com/marco-lepore/yage/commit/9b637bcd832476a6c47eb4dacb8cf33e9c5139b0), [`3fbbe3d`](https://github.com/marco-lepore/yage/commit/3fbbe3d3c936f636d5069e296a4ca228b7511c86), [`9b02d02`](https://github.com/marco-lepore/yage/commit/9b02d024fe54ea30efef01a109387b839266b791), [`8156b6d`](https://github.com/marco-lepore/yage/commit/8156b6dcc8429b738c3efeb949fafd1cce245330), [`8d061c5`](https://github.com/marco-lepore/yage/commit/8d061c54eb0bbf3aed75b2b943fef1affdce7667), [`0735a9a`](https://github.com/marco-lepore/yage/commit/0735a9a3a1fa6e3f7b8549887b9b87d43674df98), [`82db867`](https://github.com/marco-lepore/yage/commit/82db867c0176208d5968ae3aa68296db3d724955)]:
  - @yagejs/renderer@0.9.0
  - @yagejs/core@0.9.0

## 0.8.0

### Minor Changes

- [#125](https://github.com/marco-lepore/yage/pull/125) [`14fbb16`](https://github.com/marco-lepore/yage/commit/14fbb16ee2bd11adac6a225fa5fccbfb9c2b6758) Thanks [@marco-lepore](https://github.com/marco-lepore)! - `DebugDiagnostics` (the inspector's `debug` extension) gains HUD visibility controls: `isHudVisible()` and `setHudVisible(visible)`. The toggle affects only the `debug-hud` layer — the screen-space text readouts (FPS, system timings, entity counts) — leaving world-space debug graphics such as collider outlines visible, and re-renders the stage synchronously so the change reaches the canvas even while the debug clock is frozen. Capture tooling uses it to keep wall-clock-dependent text out of canvas screenshots that would otherwise differ on every run; the examples snapshot harness hides the HUD before its dump-mode screenshots.

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

### Minor Changes

- [#54](https://github.com/marco-lepore/yage/pull/54) [`cf617fe`](https://github.com/marco-lepore/yage/commit/cf617fe0f28db6ea1a5af7992b76dc19eec8cd0c) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add `DebugPlugin` `startFrozen` option for true frame-zero determinism.

  `new DebugPlugin({ startFrozen: true })` stops Pixi's ticker during plugin
  `install()` — _before_ `Engine.start()` calls `loop.start()` — and brings
  up the `DebugClock` already in frozen state. Pair with `deterministicSeed`
  for E2E replay.

  **Why:** previously the recommended pattern was `await engine.start();
inspector.time.freeze();`. Pixi auto-starts the ticker inside
  `Application.init()` (which `RendererPlugin.install` awaits), so any frame
  that ticked between then and the user-space `freeze()` mutated physics /
  input clocks non-deterministically. Snapshots taken right after the
  freeze were therefore _not_ bit-identical across runs — visible as a flaky
  `inspector-determinism.spec.ts` on slow CI runners.

  `startFrozen` closes the window: by the time `onStart()` runs and the user
  ever sees `await engine.start()` resolve, the engine has ticked zero
  frames. `inspector.time.thaw()` resumes auto-mode normally.

  Updated `examples/src/platformer.ts` to read `__YAGE_START_FROZEN__` into
  `startFrozen` instead of calling `freeze()` after `engine.start()`.

### Patch Changes

- Updated dependencies [[`cf617fe`](https://github.com/marco-lepore/yage/commit/cf617fe0f28db6ea1a5af7992b76dc19eec8cd0c), [`bc3790d`](https://github.com/marco-lepore/yage/commit/bc3790dc4c31c42c4821cd275a9376a0830bb0db), [`d998fc1`](https://github.com/marco-lepore/yage/commit/d998fc16746ee56ff3cad22a5fdf77b2ac19800b), [`d998fc1`](https://github.com/marco-lepore/yage/commit/d998fc16746ee56ff3cad22a5fdf77b2ac19800b), [`114d246`](https://github.com/marco-lepore/yage/commit/114d246820a88e68841a4f9cec2167c188269970)]:
  - @yagejs/renderer@0.5.0
  - @yagejs/core@0.5.0

## 0.4.0

### Minor Changes

- [#45](https://github.com/marco-lepore/yage/pull/45) [`0711684`](https://github.com/marco-lepore/yage/commit/0711684b642da76cd29bf250eccc646d89360805) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Inspector deterministic test mode and per-package serialization plumbing for `Inspector.snapshot()`.
  - `DebugPlugin` now wires the manual `DebugClock` into `Inspector.attachTimeController(...)` so `inspector.time.freeze()/step()` works while the plugin is active, and turns on event-log recording via `inspector.setEventLogEnabled(true)` during `onStart`.
  - `DebugConfig.deterministicSeed?: number` opt-in: when set, every scene's RNG is initialized to this seed via `inspector.setDefaultSceneSeed(...)`. Leave undefined for normal debug builds; set it from test fixtures so replays start from a known RNG state. The previous unconditional fixed seed is gone.
  - Renderer-aware diagnostics (`getLayerTransform`, `getCameraStack`) are now published via `inspector.addExtension("debug", ...)` and exposed as `DebugDiagnostics` — fetch with `inspector.getExtension<DebugDiagnostics>("debug")`. The plugin removes the extension on `onDestroy`, so they no longer leak past plugin teardown.
  - The `Period` step hotkey advances one frame through the same `DebugClock` the inspector uses, keeping the manual timeline coherent across hotkey + programmatic stepping.

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

### Minor Changes

- [#21](https://github.com/marco-lepore/yage/pull/21) [`32b35dc`](https://github.com/marco-lepore/yage/commit/32b35dcc89b5e28fdb852a08127f0a6f06ded819) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Expose camera and layer diagnostics on `window.__yage__.inspector`.
  - `inspector.getLayerTransform(sceneName, layerName)` returns the current `{ x, y, scaleX, scaleY, rotation }` of a scene's layer container, or `undefined` if the scene or layer is missing.
  - `inspector.getCameraStack()` returns one entry per `CameraComponent` in the scene stack: `{ scene, name, priority, enabled }`.

  Both are registered by `DebugPlugin` when it installs, so E2E suites and tools no longer need fixture-local helpers to read back camera/layer state.

### Patch Changes

- [#21](https://github.com/marco-lepore/yage/pull/21) [`32b35dc`](https://github.com/marco-lepore/yage/commit/32b35dcc89b5e28fdb852a08127f0a6f06ded819) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Rework the camera system into an entity + layer-binding model, and give every scene its own container.
  - `DebugScene` declares its layers without `space`; the overlay now uses the same auto-binding model as user scenes.
  - `DebugRenderSystem` factors `cam.rotation` into the world-container translation, matching the main `DisplaySystem`.
  - `findTopmostCamera` returns the highest-priority **enabled** camera on the topmost scene with one, matching `DisplaySystem`'s own selection rules instead of picking whichever camera happened to be found first.

- [#20](https://github.com/marco-lepore/yage/pull/20) [`6143e03`](https://github.com/marco-lepore/yage/commit/6143e0346820dd74d78b1d345ac4ebc5e4294769) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Adopt scene-scoped DI.
  - `DebugPlugin` now mounts a detached `DebugScene` through `SceneManager._mountDetached`, routing the overlay through the same scoped-DI lifecycle and per-scene render tree as stacked scenes while staying off the user-visible stack.

- Updated dependencies [[`233aed2`](https://github.com/marco-lepore/yage/commit/233aed24dcd68e020a20a030d13668224ce22c4b), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`7c0ced1`](https://github.com/marco-lepore/yage/commit/7c0ced138305b55473b98bf3302ff6a21e8860df), [`7c0ced1`](https://github.com/marco-lepore/yage/commit/7c0ced138305b55473b98bf3302ff6a21e8860df), [`fc717ba`](https://github.com/marco-lepore/yage/commit/fc717bac2bc530a2c396da604d614f762d272232), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c)]:
  - @yagejs/renderer@0.2.0
  - @yagejs/core@0.2.0
