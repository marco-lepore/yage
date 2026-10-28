# @yagejs-addons/loot

## 0.1.0

### Minor Changes

- [#415](https://github.com/marco-lepore/yage/pull/415) [`7764863`](https://github.com/marco-lepore/yage/commit/7764863094712cffa55404b46df1c5281669b3a7) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add typed loot tables with explicit seeded randomness, weighted pools, quantity ranges, nested tables, eligibility conditions and draws without replacement.

  Roll results include reward origins and a typed trace that explains each selection and exclusion. Definitions are validated before use, including nested references and cycles. An optional `LootComponent` uses scene randomness, emits `LootRolledEvent` with the rewards, and exposes the last roll and callback failures through the Inspector. Games keep item definitions, inventory acceptance, once-only rewards, pity counters and saved chest progress.

### Patch Changes

- Updated dependencies [[`f3f2d71`](https://github.com/marco-lepore/yage/commit/f3f2d7163c1d8f3f67c402771a8ad297f64a0a83), [`5ffc62f`](https://github.com/marco-lepore/yage/commit/5ffc62f0cb8a73c92880a09c2101d52cedfdaf03), [`590c7d2`](https://github.com/marco-lepore/yage/commit/590c7d2f0a024c27dc3c37e2272c90a59c8e1b0f), [`590c7d2`](https://github.com/marco-lepore/yage/commit/590c7d2f0a024c27dc3c37e2272c90a59c8e1b0f), [`baf2d43`](https://github.com/marco-lepore/yage/commit/baf2d4317e36f284787de78422ecf20b9bdb3d75), [`1bdcdc6`](https://github.com/marco-lepore/yage/commit/1bdcdc629ca5d6219baa95c4cc75e217f377fa07)]:
  - @yagejs/core@0.13.0
