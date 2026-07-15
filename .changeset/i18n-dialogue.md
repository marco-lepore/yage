---
"@yagejs-addons/dialogue": minor
---

Bridge dialogue to the engine localization service.

Pass `i18n: true` to `DialogueController` (or a factory bundle) to resolve dialogue text through the game's registered `LocalizationPlugin` — a line's `#line:id` is the catalog key and the authored text is the fallback. Disabled-choice reasons are now addressable by a `<lineId>.disabledReason` key. Zero-config dialogue (no plugin) is unchanged: literal text with `{param}` interpolation.

Resolution is at present time — new lines resolve in the current locale. A live locale switch does not yet retro-update a line already on screen (that needs a text-channel retranslate seam).
