---
"@yagejs/ui": minor
"@yagejs/ui-react": minor
---

UIText overflow controls: word-wrap by default + `truncate` option.

- When Yoga gives `UIText` a width constraint (`AtMost` / `Exactly`), the measure callback now enables `wordWrap` with the constraint as `wordWrapWidth` before reading `text.height`, so multi-line text is sized correctly inside a fixed-width slot.
- New `truncate?: "clip" | "ellipsis"` prop on `UIText` (and the React `<Text>` wrapper). `"clip"` keeps the text on one line and lets the parent panel's `overflow` clip it; `"ellipsis"` substring-truncates and appends `…` so the line fits the layout width.
- `TextProps` in `@yagejs/ui-react` now extends `LayoutProps`, so `<Text width={...} flex={1} />` and friends are typed correctly.
