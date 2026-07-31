# @yagejs-addons/abilities

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
