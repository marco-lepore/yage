# @yagejs-addons/i18n

## 0.1.0

### Minor Changes

- [#369](https://github.com/marco-lepore/yage/pull/369) [`edd86b4`](https://github.com/marco-lepore/yage/commit/edd86b496d55298ae9deced1a52bedfcbbb14bf5) Thanks [@marco-lepore](https://github.com/marco-lepore)! - New addon: localization for YAGE. `msg(key, fallback, values?)` describes a
  translatable string; `createLocalization` builds an i18next-backed
  `Localization` service from preloaded catalogs (plural forms through a numeric
  `count`, fallback locale, fallback text); `LocalizationPlugin` registers it and
  re-resolves every localized text on each `setLocale` call, paused scenes
  included. Localized classes per engine surface: `LocalizedTextComponent` and
  `LocalizedSplitTextComponent` (`./renderer`), `LocalizedUISurface`,
  `localizedTooltip`, and one class per text-bearing `@yagejs/ui` widget --
  `UILocalizedText`, `UILocalizedSplitText`, `UILocalizedButton`,
  `UILocalizedCheckbox`, `LocalizedPixiSelect`, `LocalizedPixiFancyButton`,
  `LocalizedPixiCheckbox`, `LocalizedPixiRadioGroup`, `LocalizedPixiInput`
  (`./ui`), `<Trans>`, `useLocalization`, and `LocalizedPixiSelect` (`./ui-react`), and
  `localizeInventoryPanel` with per-presenter wrappers for
  `@yagejs-addons/inventory` (`./inventory`). Any object implementing
  `Localization` works as a backend; a game component takes part in locale
  changes by implementing `relocalize(resolve)`.

### Patch Changes

- [#384](https://github.com/marco-lepore/yage/pull/384) [`4738d98`](https://github.com/marco-lepore/yage/commit/4738d98b8094cf13460b307880b3f48564360f2c) Thanks [@marco-lepore](https://github.com/marco-lepore)! - A catalog key containing `:` is looked up as written. The i18next backend used to read `line:abc` as key `abc` in a namespace `line`, so the entry was never found and the fallback showed; Yarn Spinner line ids take that form. `.` is still the only separator, reaching into nested catalog objects.

- [#391](https://github.com/marco-lepore/yage/pull/391) [`0c90d77`](https://github.com/marco-lepore/yage/commit/0c90d774bdbda47f5a95c92ab7aef11d7a19e7b9) Thanks [@marco-lepore](https://github.com/marco-lepore)! - The `LocalizedPixiRadioGroup.setMessages` documentation now points to `setItems()` for changing the rows, instead of saying to build a new group.

- [#391](https://github.com/marco-lepore/yage/pull/391) [`2c56bb0`](https://github.com/marco-lepore/yage/commit/2c56bb04b22f7a6be5535cd8bb5756a2720dae6b) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Declare React 19 as the supported optional peer. The React entry runs on `@yagejs/ui-react`, which requires React 19, so the advertised React 18 range never worked.

- Updated dependencies [[`eaf4af7`](https://github.com/marco-lepore/yage/commit/eaf4af741acb662d92c5fb3ae6f2f98ecce8917e), [`a1d07ae`](https://github.com/marco-lepore/yage/commit/a1d07ae42d858cf8e94f4bb8414096bdd4a09c16), [`0c90d77`](https://github.com/marco-lepore/yage/commit/0c90d774bdbda47f5a95c92ab7aef11d7a19e7b9), [`1f45e38`](https://github.com/marco-lepore/yage/commit/1f45e38d108b17e37a807c209b5d84159b88867c), [`32daae7`](https://github.com/marco-lepore/yage/commit/32daae7686eff5ac5ea5578c7d87c5db866f76f4), [`6888d06`](https://github.com/marco-lepore/yage/commit/6888d06c6fdf2361f41c5521ebdda83dc833b6c4), [`a7fd74e`](https://github.com/marco-lepore/yage/commit/a7fd74e75347a7a1b56ab18fcfb55f2f5cf4da46), [`0f9d0bc`](https://github.com/marco-lepore/yage/commit/0f9d0bce27dd933d562fa6c9c66696b647574e69), [`0f9d0bc`](https://github.com/marco-lepore/yage/commit/0f9d0bce27dd933d562fa6c9c66696b647574e69), [`8e2ea03`](https://github.com/marco-lepore/yage/commit/8e2ea031ab3dd93c2ae09177eb833e8ccd9a2681), [`908622a`](https://github.com/marco-lepore/yage/commit/908622adcf1a401251539e9edd081ad7ffc7e642), [`37a978e`](https://github.com/marco-lepore/yage/commit/37a978e20e1bb67b00b69844c57d25fecf36ffdb), [`3bab027`](https://github.com/marco-lepore/yage/commit/3bab0271c916cd65f7e7dbe17388f7f7cedf20ff), [`ca6271a`](https://github.com/marco-lepore/yage/commit/ca6271a7e3bbe4da16c0d4a9f7c28cd183ebfbd8), [`edd86b4`](https://github.com/marco-lepore/yage/commit/edd86b496d55298ae9deced1a52bedfcbbb14bf5), [`2c56bb0`](https://github.com/marco-lepore/yage/commit/2c56bb04b22f7a6be5535cd8bb5756a2720dae6b), [`c6e3095`](https://github.com/marco-lepore/yage/commit/c6e3095da135e173bfe09f801e095f1d87570b22), [`851310c`](https://github.com/marco-lepore/yage/commit/851310c54e04f5cdb52819050ca0a50f36b8e4c3), [`ba12b2f`](https://github.com/marco-lepore/yage/commit/ba12b2f0f851c2472abed23878b9598e57024d5f), [`3bab027`](https://github.com/marco-lepore/yage/commit/3bab0271c916cd65f7e7dbe17388f7f7cedf20ff), [`5efe5f6`](https://github.com/marco-lepore/yage/commit/5efe5f6de138b71048e6f4752ed74647a9fc3e76), [`d6b8138`](https://github.com/marco-lepore/yage/commit/d6b813836696a1b8afd8f6cdf7ae1ddaf83f94e8), [`d6b8138`](https://github.com/marco-lepore/yage/commit/d6b813836696a1b8afd8f6cdf7ae1ddaf83f94e8), [`7ac9d9d`](https://github.com/marco-lepore/yage/commit/7ac9d9d0fd806e5ebd552b92ef9df7eb9b897210), [`26ad39f`](https://github.com/marco-lepore/yage/commit/26ad39f22f2b1b483463005537de7e30974e17da), [`6803d9f`](https://github.com/marco-lepore/yage/commit/6803d9f859cff52f4d32d17a422e006567b9582d), [`6803d9f`](https://github.com/marco-lepore/yage/commit/6803d9f859cff52f4d32d17a422e006567b9582d), [`908622a`](https://github.com/marco-lepore/yage/commit/908622adcf1a401251539e9edd081ad7ffc7e642), [`52471e3`](https://github.com/marco-lepore/yage/commit/52471e3093691f8f039185785a53d819c0daed2a), [`908622a`](https://github.com/marco-lepore/yage/commit/908622adcf1a401251539e9edd081ad7ffc7e642), [`4218171`](https://github.com/marco-lepore/yage/commit/4218171a4561b1f561b5b62610170c0540a364ba), [`ad91188`](https://github.com/marco-lepore/yage/commit/ad91188702d2bacb03f507348881506dd7796d58), [`869129b`](https://github.com/marco-lepore/yage/commit/869129b939fd32167a559e7adf275172c7e1baff)]:
  - @yagejs/ui-react@0.12.0
  - @yagejs/core@0.12.0
  - @yagejs/renderer@0.12.0
  - @yagejs-addons/inventory@0.4.0
  - @yagejs/ui@0.12.0
