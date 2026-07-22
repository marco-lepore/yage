# @yagejs-addons/quests

## 0.1.0

### Minor Changes

- [#176](https://github.com/marco-lepore/yage/pull/176) [`b2ad1ac`](https://github.com/marco-lepore/yage/commit/b2ad1ac15a0d3767e83a94115ee524cc1a13da05) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add the `@yagejs-addons/quests` addon: a headless `QuestLog` model (`defineQuests` two-level id capture, flat `requires` prerequisites, per-objective progress, auto-complete rollup, snapshot/restore) plus an optional `QuestController` that mirrors model events onto the engine bus. Objectives bind to other addons' events through game-authored one-line adapters — no dialogue/inventory dependency.

- [#176](https://github.com/marco-lepore/yage/pull/176) [`b2ad1ac`](https://github.com/marco-lepore/yage/commit/b2ad1ac15a0d3767e83a94115ee524cc1a13da05) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Support turn-in quests whose requirements can become incomplete before completion.
  - Add the `autoComplete` quest policy and `canComplete()` readiness check.
  - Make `completeQuest()` require satisfied objectives and add `forceCompleteQuest()` as the explicit escape hatch.
  - Rename objective progress events so both increases and decreases use accurate terminology.
