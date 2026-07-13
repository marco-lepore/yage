---
"@yagejs/ui": minor
---

Fixes the ui-react reconciler's element teardown and prop-removal handling — both required underlying changes here.

- Every element's `destroy()` (`PanelNode`, `UIButton`, `UICheckbox`, `UIImage`, `UINineSlice`, `UIProgressBar`, `UIText`, `UISplitText`, `ScrollViewNode`) is now idempotent — a second call is a no-op instead of double-freeing its Yoga node.
- `update()` on every element now treats a present-but-`undefined` prop key as "reset this prop to its default" (a cleared background, an unbound handler, a layout value back to its Yoga default) instead of silently ignoring it. `applyLayoutProps`/`applyLayoutValue` apply the same key-presence contract for the shared `LayoutProps` fields.
