# @yagejs-addons/behavior-tree

## 0.1.0

### Minor Changes

- [#413](https://github.com/marco-lepore/yage/pull/413) [`42c6825`](https://github.com/marco-lepore/yage/commit/42c68255eb2ad068b49e3de8654f8e2c79819f21) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add typed behavior trees with per-entity execution and Inspector diagnostics.
  - Compose actions, instant `call` actions, conditions, remembered or reactive sequences and selectors, parallel branches, guards, waits, timeouts, repeats, retries, inversion, forced results, and reusable subtrees.
  - Add probability gates, weighted choices with failure policies, sampled reaction waits, and cooldowns. Supply constants or typed context callbacks; mounted trees use the scene random generator.
  - Release running actions before replacement work starts, with explicit cancellation reasons and callback errors attributed through YAGE's ErrorBoundary. After a callback throws, every `tick()` throws until the tree is cancelled.
  - Mount with `new BehaviorTreeAgent(definition, context)` on scaled frame or fixed time, or tick the headless `BehaviorTree` runner directly. Inspect active nodes, bounded transition history, sampled values, and callback failures.
  - Save and restore cooldowns as plain JSON with `snapshot()` and `restore()`.
  - Pass live state readers, owner commands, and capability references through one typed context, without copying game state.

### Patch Changes

- Updated dependencies [[`f3f2d71`](https://github.com/marco-lepore/yage/commit/f3f2d7163c1d8f3f67c402771a8ad297f64a0a83), [`5ffc62f`](https://github.com/marco-lepore/yage/commit/5ffc62f0cb8a73c92880a09c2101d52cedfdaf03), [`590c7d2`](https://github.com/marco-lepore/yage/commit/590c7d2f0a024c27dc3c37e2272c90a59c8e1b0f), [`590c7d2`](https://github.com/marco-lepore/yage/commit/590c7d2f0a024c27dc3c37e2272c90a59c8e1b0f), [`baf2d43`](https://github.com/marco-lepore/yage/commit/baf2d4317e36f284787de78422ecf20b9bdb3d75), [`1bdcdc6`](https://github.com/marco-lepore/yage/commit/1bdcdc629ca5d6219baa95c4cc75e217f377fa07)]:
  - @yagejs/core@0.13.0
