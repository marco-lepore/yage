---
"@yagejs-addons/dialogue": minor
---

Bridge dialogue to the engine localization service, with live retranslation.

Pass `i18n: true` to `DialogueController` (or a factory bundle) to resolve dialogue text through the game's registered `LocalizationPlugin` — a line's `#line:id` is the catalog key and the authored text is the fallback. A locale switch retranslates the on-screen line and choices live: the typewriter restarts on the new text, choice selection is preserved, line commands and observation events do not re-fire, and voice keeps playing. Custom adapters get the same behavior by calling `retranslate()` after a language change. Disabled-choice reasons are addressable by a `<lineId>.disabledReason` key. Zero-config dialogue (no plugin) is unchanged: literal text with `{param}` interpolation.
