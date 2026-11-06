# @yagejs-addons/perception

## 0.1.0

### Minor Changes

- [#417](https://github.com/marco-lepore/yage/pull/417) [`4d72844`](https://github.com/marco-lepore/yage/commit/4d728445a7121889713334f4c967cb1f5a2d96a3) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add 2D sight and last-seen memory through the `PerceptionSensor` component and the headless `PerceptionMemory` model.
  - Configure acquisition and retention range, field of view, facing direction, eligibility, visibility, and line-of-sight checks. `perceptionRaycast()` from the `/physics` subpath blocks sight with the scene's colliders.
  - Read the observation of a given entity with `observationOf(entity)`, every visible or remembered target, and the rejection reason of each candidate. Entity events report detection, loss, and forgetting.
  - Save observations of keyed targets with `snapshot()` and restore them by entity key with `restore(snapshot)`. Observations are tracked per life of an entity, so a pooled entity's next life starts unobserved.

### Patch Changes

- Updated dependencies [[`504f688`](https://github.com/marco-lepore/yage/commit/504f6889ddba1db454afa85045b76d383c70f811), [`f3f2d71`](https://github.com/marco-lepore/yage/commit/f3f2d7163c1d8f3f67c402771a8ad297f64a0a83), [`5ffc62f`](https://github.com/marco-lepore/yage/commit/5ffc62f0cb8a73c92880a09c2101d52cedfdaf03), [`590c7d2`](https://github.com/marco-lepore/yage/commit/590c7d2f0a024c27dc3c37e2272c90a59c8e1b0f), [`590c7d2`](https://github.com/marco-lepore/yage/commit/590c7d2f0a024c27dc3c37e2272c90a59c8e1b0f), [`2869e2a`](https://github.com/marco-lepore/yage/commit/2869e2a7888a6674e49c9af654ac22311cb2985b), [`960939a`](https://github.com/marco-lepore/yage/commit/960939a48fcfb30f73e3f8d85d0338197c827097), [`baf2d43`](https://github.com/marco-lepore/yage/commit/baf2d4317e36f284787de78422ecf20b9bdb3d75), [`1bdcdc6`](https://github.com/marco-lepore/yage/commit/1bdcdc629ca5d6219baa95c4cc75e217f377fa07)]:
  - @yagejs/physics@0.13.0
  - @yagejs/core@0.13.0
