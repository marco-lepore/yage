# @yagejs-addons/quests

## 0.2.0

### Minor Changes

- [#220](https://github.com/marco-lepore/yage/pull/220) [`1c2f8e4`](https://github.com/marco-lepore/yage/commit/1c2f8e45fd806973b234fc5b6045f9f807dceafa) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Addon components now follow entity activeness, so disabling a component or deactivating its entity also sleeps resources that live outside `update()`.

  `QuestController` stops its model-to-entity event mirror while dormant and restores it on enable. The standalone `QuestLog` remains live, and dormant events are not replayed.

### Patch Changes

- Updated dependencies [[`34d45fd`](https://github.com/marco-lepore/yage/commit/34d45fd690d747b7d8dd36a5972ef20d21d574da), [`f48983d`](https://github.com/marco-lepore/yage/commit/f48983dbb4e43c25b455ac3f96e7d8684266bbc3), [`042755b`](https://github.com/marco-lepore/yage/commit/042755b5649a90e99c8840747349255fbb3f95be), [`f1048ab`](https://github.com/marco-lepore/yage/commit/f1048ab756feee84e593609521c3a58fcfc1c1a7), [`4a5b3b6`](https://github.com/marco-lepore/yage/commit/4a5b3b639ddcbb285b6a4733b89d27bcee14c50c), [`d459026`](https://github.com/marco-lepore/yage/commit/d4590265b9aa5297fb99d20b92bb5a2f19cac0c5)]:
  - @yagejs/core@0.10.0

## 0.1.0

### Minor Changes

- [#176](https://github.com/marco-lepore/yage/pull/176) [`b2ad1ac`](https://github.com/marco-lepore/yage/commit/b2ad1ac15a0d3767e83a94115ee524cc1a13da05) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add the `@yagejs-addons/quests` addon: a headless `QuestLog` model (`defineQuests` two-level id capture, flat `requires` prerequisites, per-objective progress, auto-complete rollup, snapshot/restore) plus an optional `QuestController` that mirrors model events onto the engine bus. Objectives bind to other addons' events through game-authored one-line adapters — no dialogue/inventory dependency.

- [#176](https://github.com/marco-lepore/yage/pull/176) [`b2ad1ac`](https://github.com/marco-lepore/yage/commit/b2ad1ac15a0d3767e83a94115ee524cc1a13da05) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Support turn-in quests whose requirements can become incomplete before completion.
  - Add the `autoComplete` quest policy and `canComplete()` readiness check.
  - Make `completeQuest()` require satisfied objectives and add `forceCompleteQuest()` as the explicit escape hatch.
  - Rename objective progress events so both increases and decreases use accurate terminology.
