# @yagejs-addons/abilities

## 0.1.0

### Minor Changes

- [#201](https://github.com/marco-lepore/yage/pull/201) [`0574e44`](https://github.com/marco-lepore/yage/commit/0574e44d68df2568c57d0275aff139bddebb06da) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add phase-based abilities and concrete combat primitives.
  - Add the phase-based ability runner with intents, cooldowns, cancel windows, holds, definition tags, runtime loadout replacement, lifecycle events, and the optional input driver.
  - Add the concrete hit contract with hitboxes, projectiles, touch damage, guards, health, reactions, hitstop support, and typed custom hit-data tools.
  - Keep the root entry headless and expose input integration only through the optional `/input` entry.
