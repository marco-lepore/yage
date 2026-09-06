# @yagejs-addons/abilities

## 0.4.0

### Minor Changes

- [#327](https://github.com/marco-lepore/yage/pull/327) [`d2adfed`](https://github.com/marco-lepore/yage/commit/d2adfedb0e5d15269fe941a3a24f23ddb0126aa4) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Clarify addon composition and lifecycle contracts.
  - Add lane-scoped `release` and have `AbilityDriver` release its own activation's lane.
  - Attribute step hooks and cooldown callbacks. Reject non-finite cooldowns before cooldown state changes; a throwing hook remains terminal.
  - Ignore destroyed hit targets without invalidating attacks from destroyed casters.
  - Add typed `spawn.acquire` for game-owned pools, including optional setup-context inference. Returning `undefined` skips the spawn without a fallback.
  - Add `Projectile.sensor`, `gravityScale`, and `consume` for solid collision response and one-way platform composition. The supplied projectile is not poolable.
  - Rename health and hit event ids to `abilities:health:*` and `abilities:hit:*`. Existing exported tokens remain; old string ids are not aliases.

- [#304](https://github.com/marco-lepore/yage/pull/304) [`daa8214`](https://github.com/marco-lepore/yage/commit/daa821458a69d14176f5c5aebc3f4204348ddb0c) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Remove `HealthSnapshot` and automatic `Health` serialization. Games that treat
  health as durable state should store `{ hp, max }` in their explicit save root
  and construct `Health` from those values.

### Patch Changes

- Updated dependencies [[`dc42ba4`](https://github.com/marco-lepore/yage/commit/dc42ba40cd3bbd04c8ff27bf4e8721f274dde034), [`daa8214`](https://github.com/marco-lepore/yage/commit/daa821458a69d14176f5c5aebc3f4204348ddb0c), [`daa8214`](https://github.com/marco-lepore/yage/commit/daa821458a69d14176f5c5aebc3f4204348ddb0c), [`c105024`](https://github.com/marco-lepore/yage/commit/c105024b5402c11dc36da52b08f6ab39354da8a5), [`c8ad215`](https://github.com/marco-lepore/yage/commit/c8ad215530681caeb63484cc07b118cd977a5ba5), [`08b0d06`](https://github.com/marco-lepore/yage/commit/08b0d06b63a44a51bd6f8e8308574fd41c96af59), [`33d00e3`](https://github.com/marco-lepore/yage/commit/33d00e37801a300710cc10de0352b1aa1b1ba2f1), [`7275620`](https://github.com/marco-lepore/yage/commit/7275620756183b22de3df1009e1e07615db9b40e), [`4bab66f`](https://github.com/marco-lepore/yage/commit/4bab66f0e34a387155bbc7168b048dcac167525f), [`cfde97d`](https://github.com/marco-lepore/yage/commit/cfde97de2c94416cb5bbab26a12f9c290e6b66cf), [`9e194ec`](https://github.com/marco-lepore/yage/commit/9e194ec386a74c0f1ad5699c3c0db183aa86f1b1), [`33d00e3`](https://github.com/marco-lepore/yage/commit/33d00e37801a300710cc10de0352b1aa1b1ba2f1), [`0ca4c91`](https://github.com/marco-lepore/yage/commit/0ca4c91b46a7d147da803d0d6db54e8e1b5489ce), [`05492cb`](https://github.com/marco-lepore/yage/commit/05492cb8e27f89fe82fedd6e307afa2f90d1f68f), [`05492cb`](https://github.com/marco-lepore/yage/commit/05492cb8e27f89fe82fedd6e307afa2f90d1f68f), [`aed53f7`](https://github.com/marco-lepore/yage/commit/aed53f7f5679f824846dee3c55c0342f7f07cf98), [`01f3944`](https://github.com/marco-lepore/yage/commit/01f39449f8856d1ed0e3e842a6ea1173a7a49ec6), [`01f3944`](https://github.com/marco-lepore/yage/commit/01f39449f8856d1ed0e3e842a6ea1173a7a49ec6), [`33d00e3`](https://github.com/marco-lepore/yage/commit/33d00e37801a300710cc10de0352b1aa1b1ba2f1), [`ba57361`](https://github.com/marco-lepore/yage/commit/ba5736175e8b3e06157e680b4b66d10eb8d06823), [`0273a69`](https://github.com/marco-lepore/yage/commit/0273a69dfe675e636e1488c6c81c9072c1e64b35), [`a7eda5d`](https://github.com/marco-lepore/yage/commit/a7eda5d7cee1e163ea09362709d7ab35687f0fb6), [`aaf1279`](https://github.com/marco-lepore/yage/commit/aaf1279455bc655681cf15c8edc64b1407b2a823), [`0bc41ac`](https://github.com/marco-lepore/yage/commit/0bc41ac6c3cce2770a588d90f2662b21c458ed71), [`8064fa6`](https://github.com/marco-lepore/yage/commit/8064fa64099feeb1d164360b668e0721a14b7bbe), [`8f11936`](https://github.com/marco-lepore/yage/commit/8f119362281bf31ab59b8b907816886922aaf18f), [`b087462`](https://github.com/marco-lepore/yage/commit/b087462ab2ae27bebb7ce274402c9e278f6d472a), [`8bb9e0b`](https://github.com/marco-lepore/yage/commit/8bb9e0b905017ac724f70fc8fe55014605563e88), [`8d7b5e3`](https://github.com/marco-lepore/yage/commit/8d7b5e3fe395898c7f4cbde0b352acc2713e6559), [`8d7b5e3`](https://github.com/marco-lepore/yage/commit/8d7b5e3fe395898c7f4cbde0b352acc2713e6559), [`ff52a8a`](https://github.com/marco-lepore/yage/commit/ff52a8a4816b18f7de5309ab08606183db67e071)]:
  - @yagejs/core@0.11.0
  - @yagejs/physics@0.11.0
  - @yagejs/input@0.11.0

## 0.3.0

### Minor Changes

- [#263](https://github.com/marco-lepore/yage/pull/263) [`6eaad69`](https://github.com/marco-lepore/yage/commit/6eaad6992b0923ec194e3d5e5c3f1eb812afbee8) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Ability timing is game logic, so it advances on the fixed timestep by default.
  - **Breaking:** `Abilities` phase timelines, linger windows, and cooldowns advance on the fixed timestep. They counted rendered-frame time before, which made ability windows drift with the frame rate on displays faster or slower than the fixed step. Pass `new Abilities(defs, { clock: "frame" })` for a purely presentation-driven timeline with no simulation coupling; `abilities.clock` is readable so custom steps can schedule matching timers via `pc.run(p, { clock })`.
  - **Breaking:** the addon's other gameplay timers moved with it: `HitReceiver` i-frames, `Stagger`, `TouchDamage` intervals, and hitbox `follow` tracking run in `fixedUpdate`, and `Projectile` lifetime counts fixed-step seconds — so projectile range (speed × lifetime) holds when frame time and simulation time diverge.
  - Presentation is unaffected: `anim`-triggered `KeyframeAnimator` playback keeps rendered-frame time, and so does any tween a step starts unless the step schedules it on another clock explicitly. `AbilityDriverComponent` still samples input once per rendered frame.
  - The `@yagejs/core` peer range floor rises to the first version whose `ProcessComponent` accepts the `clock` option, so an older core cannot silently ignore it.

### Patch Changes

- [#265](https://github.com/marco-lepore/yage/pull/265) [`3cb9d19`](https://github.com/marco-lepore/yage/commit/3cb9d190e4720816c7ba83a1e6fafd4b05d2684e) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Input edge queries resolve against the caller's execution context — frame code reads frame windows, fixed-step code reads per-step windows.
  - Documentation only: `AbilityDriverComponent`'s note on per-frame input sampling states the current rationale (an intent is forwarded on the frame its edge lands, independent of the frame's fixed-step count) instead of the outdated claim that fixed-step polling would miss or double-see edges.

## 0.2.0

### Minor Changes

- [#220](https://github.com/marco-lepore/yage/pull/220) [`1c2f8e4`](https://github.com/marco-lepore/yage/commit/1c2f8e45fd806973b234fc5b6045f9f807dceafa) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Addon components now follow entity activeness, so disabling a component or deactivating its entity also sleeps resources that live outside `update()`.
  - `Abilities` pauses active phases, linger, and cooldowns while dormant. It refuses new actions and temporarily releases effects owned by open windows without changing sibling component state.
  - Custom window steps can implement `onDisable` and `onEnable` hooks to apply the same lifecycle to game-owned effects.
  - `AbilityDriverComponent` releases input listeners and owned holds, `TouchDamage` releases collision callbacks, `HitReceiver` ignores direct hits, and `Stagger` writes zero velocity while dormant.

### Patch Changes

- Updated dependencies [[`34d45fd`](https://github.com/marco-lepore/yage/commit/34d45fd690d747b7d8dd36a5972ef20d21d574da), [`34d45fd`](https://github.com/marco-lepore/yage/commit/34d45fd690d747b7d8dd36a5972ef20d21d574da), [`34d45fd`](https://github.com/marco-lepore/yage/commit/34d45fd690d747b7d8dd36a5972ef20d21d574da), [`6fc90a5`](https://github.com/marco-lepore/yage/commit/6fc90a5635395e18c6f466d36e2477f8264ddbe9), [`f48983d`](https://github.com/marco-lepore/yage/commit/f48983dbb4e43c25b455ac3f96e7d8684266bbc3), [`042755b`](https://github.com/marco-lepore/yage/commit/042755b5649a90e99c8840747349255fbb3f95be), [`042755b`](https://github.com/marco-lepore/yage/commit/042755b5649a90e99c8840747349255fbb3f95be), [`f1048ab`](https://github.com/marco-lepore/yage/commit/f1048ab756feee84e593609521c3a58fcfc1c1a7), [`4a5b3b6`](https://github.com/marco-lepore/yage/commit/4a5b3b639ddcbb285b6a4733b89d27bcee14c50c), [`4a5b3b6`](https://github.com/marco-lepore/yage/commit/4a5b3b639ddcbb285b6a4733b89d27bcee14c50c), [`d459026`](https://github.com/marco-lepore/yage/commit/d4590265b9aa5297fb99d20b92bb5a2f19cac0c5), [`6fc90a5`](https://github.com/marco-lepore/yage/commit/6fc90a5635395e18c6f466d36e2477f8264ddbe9)]:
  - @yagejs/core@0.10.0
  - @yagejs/input@0.10.0
  - @yagejs/physics@0.10.0

## 0.1.0

### Minor Changes

- [#201](https://github.com/marco-lepore/yage/pull/201) [`0574e44`](https://github.com/marco-lepore/yage/commit/0574e44d68df2568c57d0275aff139bddebb06da) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add phase-based abilities and concrete combat primitives.
  - Add the phase-based ability runner with intents, cooldowns, cancel windows, holds, definition tags, runtime loadout replacement, lifecycle events, and the optional input driver.
  - Add the concrete hit contract with hitboxes, projectiles, touch damage, guards, health, reactions, hitstop support, and typed custom hit-data tools.
  - Keep the root entry headless and expose input integration only through the optional `/input` entry.
