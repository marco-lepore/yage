---
"@yagejs/ui-react": patch
---

Rename the UI element/Component split so the `UI*` prefix uniformly means "renderable UIElement".

- Internal adaptation to the `@yagejs/ui` renames (`UIPanel`, `UIScrollView`, `UIPanelProps`, `UIScrollViewProps`); the public JSX API is unchanged.
