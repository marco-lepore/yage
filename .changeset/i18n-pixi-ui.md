---
"@yagejs/ui": minor
---

Localize the `@pixi/ui` widget wrappers.

`PixiFancyButton`, `PixiCheckbox`, `PixiInput` (placeholder), `PixiSelect` (items), and `PixiRadioGroup` (item labels) now accept `string | LocalizedBinding` for their text and re-resolve on locale change, matching the native sinks. `@pixi/ui` bakes each string into its widget at construction with no public setter, so `PixiInput` and `PixiSelect` drive the update through YAGE subclasses: the input placeholder is refreshed in place (focus and editing preserved), and each dropdown option updates its button label, its emitted `onSelect` text, and the selected label while keeping the open/selected/scroll state. `PixiInput.value` stays a plain string — it is user input, never localized.
