# @yagejs-addons/stats

## 0.1.0

### Minor Changes

- [#406](https://github.com/marco-lepore/yage/pull/406) [`b02cc4e`](https://github.com/marco-lepore/yage/commit/b02cc4e4227d876b3a483ffb4f94bac8118ee3ca) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add numeric stats, equipment modifiers, timed effects, and game-authored damage formulas.
  - Compose source-owned base additions, flat bonuses, base percentages, summed percentages, independent multipliers, and priority overrides with optional bounds and rounding.
  - Replace equipment modifiers by source, cancel or refresh timed effects, and configure stacking limits, newest-effect selection, or highest-rank selection.
  - Let derived stats declare dependencies on base or effective values. Define damage formulas with dependency validation, cycle detection, and named intermediate results.
  - Advance effect durations with an optional entity component that follows scene and entity time scaling. Save and restore bases, modifier ownership, stacking order, and remaining durations.

### Patch Changes

- Updated dependencies [[`a1d07ae`](https://github.com/marco-lepore/yage/commit/a1d07ae42d858cf8e94f4bb8414096bdd4a09c16), [`0c90d77`](https://github.com/marco-lepore/yage/commit/0c90d774bdbda47f5a95c92ab7aef11d7a19e7b9), [`6888d06`](https://github.com/marco-lepore/yage/commit/6888d06c6fdf2361f41c5521ebdda83dc833b6c4), [`1520781`](https://github.com/marco-lepore/yage/commit/15207819383c8f9ea7ea299bf46aba07a0ee1a53), [`0f9d0bc`](https://github.com/marco-lepore/yage/commit/0f9d0bce27dd933d562fa6c9c66696b647574e69), [`8e2ea03`](https://github.com/marco-lepore/yage/commit/8e2ea031ab3dd93c2ae09177eb833e8ccd9a2681), [`908622a`](https://github.com/marco-lepore/yage/commit/908622adcf1a401251539e9edd081ad7ffc7e642), [`ce75bb9`](https://github.com/marco-lepore/yage/commit/ce75bb9f245266f5f382232c25b9e77b66c25b0a), [`3bab027`](https://github.com/marco-lepore/yage/commit/3bab0271c916cd65f7e7dbe17388f7f7cedf20ff), [`847ce80`](https://github.com/marco-lepore/yage/commit/847ce80baad0ed2a18569db9f28f185c61ab7c35), [`3bab027`](https://github.com/marco-lepore/yage/commit/3bab0271c916cd65f7e7dbe17388f7f7cedf20ff), [`5efe5f6`](https://github.com/marco-lepore/yage/commit/5efe5f6de138b71048e6f4752ed74647a9fc3e76), [`d6b8138`](https://github.com/marco-lepore/yage/commit/d6b813836696a1b8afd8f6cdf7ae1ddaf83f94e8), [`7ac9d9d`](https://github.com/marco-lepore/yage/commit/7ac9d9d0fd806e5ebd552b92ef9df7eb9b897210), [`7aba1d9`](https://github.com/marco-lepore/yage/commit/7aba1d91bef7d4172a18cb8e88092cbebab3d09b)]:
  - @yagejs/core@0.12.0
