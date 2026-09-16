---
"@yagejs/ui-react": patch
---

A React UI tree moves after it is mounted, and `<ProgressBar>` takes a ref.

- `UIRoot.setOffset(x, y)` shifts a mounted tree without changing its anchor, and `UIRoot.offset` reads the pair back. A non-finite value throws and names the argument. The constructor copies the `offset` option it is given, so the caller's object is never written to.
- A layout-overflow warning from a React tree names the entity the tree is mounted on, matching the warning from an imperative `UISurface`.
- `<ProgressBar>` forwards a ref to its `UIProgressBar` node, so `ref.current.value` reads the fraction it drew. `Panel`, `SplitText` and `ScrollView` forward a ref the same way.
