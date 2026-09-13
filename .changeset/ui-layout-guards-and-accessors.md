---
"@yagejs/ui": patch
---

A nine-slice element or background laid out smaller than its own insets now warns, in development builds. It warns once per episode: an element that fits again is forgotten, so the next time it is laid out too small, or given art with larger insets, it warns once more. Below `leftWidth + rightWidth` the corners overlap and the middle column has no room; the same happens vertically. The art folds in on itself and the label inside lands on a carved lip, which reads as a positioning bug. Nothing is clamped, because clamping would silently move the element.

A `UIText` the layout engine sizes without measuring now wraps to its computed width, and one with `truncate` set now cuts to it. The engine calls a measure function only when an axis is left to measure, and that callback was the only place word wrap was switched on and the truncated string was built. Both axes pinned leaves nothing to measure, and so does a single pinned axis inside a plain panel, where the default stretch alignment fills the other one. Such a text rendered one unbroken line, and a truncating one spilled its whole source past the slot edge. Replacing the style or switching truncation off leaves the wrap in place.

`UITextProps` gains `truncateWith`, the string the `"ellipsis"` mode appends. It defaults to `"…"` (U+2026), which several pixel fonts lack; pass `"..."` for one of those. `UIButton` forwards it to its label beside `truncate`.

`UISurface.setOffset(x, y)` moves a mounted tree, with an `offset` getter to read it back — animating a sliding panel no longer means writing into an internal field.

`UIProgressBar.value` reads the fill fraction back, clamped as the bar stored it.

A `UISplitText` given an empty string renders nothing instead of throwing. Pixi's split of an empty string produces no line containers, and the split then called `addChild` with no arguments, which threw a `TypeError` naming Pixi internals and stopped the whole surface rendering. Clearing a label and setting it again now works; the empty state emits empty segments to `onSplit` listeners and measures zero.
