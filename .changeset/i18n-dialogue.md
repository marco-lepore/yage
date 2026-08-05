---
"@yagejs-addons/dialogue": patch
---

Bridge dialogue to the engine localization service, with live retranslation.

Pass `i18n: true` to `DialogueController` to resolve dialogue text through the game's registered `LocalizationPlugin` — a line's `#line:id` is the catalog key and the authored text is the fallback. A locale switch then retranslates the on-screen line and choices live. Custom adapters get the same behavior by calling `retranslate()` after a language change. Disabled-choice reasons are addressable by a `<lineId>.disabledReason` key. Zero-config dialogue (no plugin) is unchanged: literal text with `{param}` interpolation.

What retranslation does to a line in flight: one still typing restarts its typewriter on the new text and replays that line's inline `[marker/]` beats as it retypes; one the player has already read appears complete instead, as does one on a paused session (a paused session drives no clock, so a restarted typewriter would leave the line blank). Either way the line is not re-announced — `onRevealCompleted` and a history channel's `revealComplete` fire once per line, `onLine` / `onChoiceShown` are not re-emitted, line commands do not re-run, voice keeps playing, and the choice selection is preserved.
