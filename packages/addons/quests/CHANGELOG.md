# @yagejs-addons/quests

## 0.3.0

### Minor Changes

- [#327](https://github.com/marco-lepore/yage/pull/327) [`d2adfed`](https://github.com/marco-lepore/yage/commit/d2adfedb0e5d15269fe941a3a24f23ddb0126aa4) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Clarify addon composition and lifecycle contracts.
  - Install the full restored quest log before notifying listeners. Active automatic quests that meet current targets emit `questCompleted` before `changed`, allowing listeners to start dependent quests. Restore does not replay objective-completion events or auto-complete manual, completed, or failed quests.

### Patch Changes

- Updated dependencies [[`dc42ba4`](https://github.com/marco-lepore/yage/commit/dc42ba40cd3bbd04c8ff27bf4e8721f274dde034), [`daa8214`](https://github.com/marco-lepore/yage/commit/daa821458a69d14176f5c5aebc3f4204348ddb0c), [`c105024`](https://github.com/marco-lepore/yage/commit/c105024b5402c11dc36da52b08f6ab39354da8a5), [`c8ad215`](https://github.com/marco-lepore/yage/commit/c8ad215530681caeb63484cc07b118cd977a5ba5), [`08b0d06`](https://github.com/marco-lepore/yage/commit/08b0d06b63a44a51bd6f8e8308574fd41c96af59), [`33d00e3`](https://github.com/marco-lepore/yage/commit/33d00e37801a300710cc10de0352b1aa1b1ba2f1), [`7275620`](https://github.com/marco-lepore/yage/commit/7275620756183b22de3df1009e1e07615db9b40e), [`4bab66f`](https://github.com/marco-lepore/yage/commit/4bab66f0e34a387155bbc7168b048dcac167525f), [`cfde97d`](https://github.com/marco-lepore/yage/commit/cfde97de2c94416cb5bbab26a12f9c290e6b66cf), [`9e194ec`](https://github.com/marco-lepore/yage/commit/9e194ec386a74c0f1ad5699c3c0db183aa86f1b1), [`05492cb`](https://github.com/marco-lepore/yage/commit/05492cb8e27f89fe82fedd6e307afa2f90d1f68f), [`aed53f7`](https://github.com/marco-lepore/yage/commit/aed53f7f5679f824846dee3c55c0342f7f07cf98), [`ba57361`](https://github.com/marco-lepore/yage/commit/ba5736175e8b3e06157e680b4b66d10eb8d06823), [`aaf1279`](https://github.com/marco-lepore/yage/commit/aaf1279455bc655681cf15c8edc64b1407b2a823), [`8064fa6`](https://github.com/marco-lepore/yage/commit/8064fa64099feeb1d164360b668e0721a14b7bbe), [`8f11936`](https://github.com/marco-lepore/yage/commit/8f119362281bf31ab59b8b907816886922aaf18f), [`b087462`](https://github.com/marco-lepore/yage/commit/b087462ab2ae27bebb7ce274402c9e278f6d472a), [`8bb9e0b`](https://github.com/marco-lepore/yage/commit/8bb9e0b905017ac724f70fc8fe55014605563e88), [`8d7b5e3`](https://github.com/marco-lepore/yage/commit/8d7b5e3fe395898c7f4cbde0b352acc2713e6559), [`ff52a8a`](https://github.com/marco-lepore/yage/commit/ff52a8a4816b18f7de5309ab08606183db67e071)]:
  - @yagejs/core@0.11.0

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
