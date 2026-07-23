---
"@yagejs/renderer": patch
"@yagejs/ui-react": patch
---

Correct JSDoc code examples so editor tooltips and the generated API reference match the shipped API. `@yagejs/renderer`: camera `shake`/`zoomTo` example durations are in seconds, and `defaultTextStyle` no longer lists `resolution` (it is a `TextComponent` constructor option, not a style property). `@yagejs/ui-react`: the `SplitText` reveal examples use `Tween.custom` setters instead of `Tween.to`, which only accepts a plain `Record<string, number>`.
