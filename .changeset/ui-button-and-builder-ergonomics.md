---
"@yagejs/ui": patch
---

A button's hover and press backgrounds are derived from the background it was given, instead of falling back to a flat grey. A colour is scaled to 1.25x for hover and 0.75x for press; a texture keeps its texture and scales its tint, so a textured button no longer flashes grey under the pointer. An explicit `hoverBackground` or `pressBackground` still wins, and a button with no background at all renders exactly as before.

`UIButtonProps` gains `direction`, `gap`, `padding`, `alignItems` and `justifyContent`, so an icon-plus-label button is `direction: "row"` rather than a nested panel. A button still stacks its children in a column and centres them on both axes by default, and `padding` replaces the default 12 px horizontal and 6 px vertical padding at any size.

`UIScrollView` gains the four builders a panel has — `text`, `button`, `panel` and `scrollView` — adding to its content.

`panel.text(content, style, opts)` takes a third argument carrying the rest of `UITextProps`, which puts `bitmap`, `resolution`, `truncate` and the layout props within reach of the builder. `UISurface.text` and the new `UIScrollView.text` take it too.

The package exports the `UITextBuilderProps`, `AlignItems` and `JustifyContent` types, so a caller can name that third argument and the two alignment props in its own signatures.

The package documentation now states a button's default background, its derived hover and press states, its default padding and the way to ask for no background at all.
