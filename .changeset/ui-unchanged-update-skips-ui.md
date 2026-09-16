---
"@yagejs/ui": patch
---

An update that repeats the values in force costs nothing, and a disabled button paints the background its own update supplies.

- A background is drawn again only when its options differ from the ones it was drawn from. An update repeating them returns before copying the options, so a React re-render of an unchanged tree allocates nothing and draws nothing.
- Text set to truncate with an ellipsis re-truncates only when the suffix changes. Repeating the suffix in force leaves the drawn text and the layout as they are.
- A disabled button shows the background from the same update that supplies it, both when that update disables the button and when it reaches a button already disabled.
