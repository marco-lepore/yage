---
"@yagejs/ui": patch
---

Localize the `@pixi/ui` widget wrappers.

`PixiFancyButton`, `PixiCheckbox`, `PixiInput` (placeholder), `PixiSelect` (items), and `PixiRadioGroup` (item labels) accept `string | LocalizedBinding` for their text and re-resolve on locale change, matching the native sinks. `@pixi/ui` bakes each string into its widget at construction with no public setter, so `PixiInput` and `PixiSelect` drive the update through YAGE subclasses: the input placeholder is refreshed in place (focus and editing preserved), and each dropdown option updates its button label, its emitted `onSelect` text, and the selected label while keeping the open/selected/scroll state. `PixiInput.value` stays a plain string — it is user input, never localized.

Two limits worth knowing. `PixiSelect.items` and `PixiRadioGroup.items` are construction-only: a later `update({ items })` is ignored and only localization refreshes the labels in place, so recreate the component to change which options exist. Widget teardown detaches the view props you passed in (`bg`, `defaultView`, `closedBG`, …) before destroying the widget, so a view the game built and reuses across mounts survives; everything the widget built for itself is destroyed with it.
