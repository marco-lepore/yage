---
"@yagejs-addons/i18n": minor
---

New addon: localization for YAGE. `msg(key, fallback, values?)` describes a
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
