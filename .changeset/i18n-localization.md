---
"@yagejs/core": minor
"@yagejs/renderer": minor
"@yagejs/ui": minor
"@yagejs/ui-react": minor
---

Add localization (i18n) contract and reactive text bindings.

`@yagejs/core` gains a `LocalizationAdapter` interface — wrap your i18n library (i18next, FormatJS, Fluent, or the built-in `Intl` API) — plus a plain-data `LocalizedBinding`, a `msg()` factory, and a `LocalizationPlugin` that re-renders bound text when the locale changes. YAGE owns the reactive binding; the library owns resolution and the catalog format.

Every native text sink — `TextComponent`, `SplitTextComponent`, `UIText`, `UISplitText`, `UIButton`, `UICheckbox`, and the `@yagejs/ui-react` wrappers — now accepts `string | LocalizedBinding` and re-resolves on locale change (ECS via `Component.addCleanup`, UI via panel attach/detach, React via `useSyncExternalStore`).
