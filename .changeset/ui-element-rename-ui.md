---
"@yagejs/ui": minor
---

Rename the UI element/Component split so the `UI*` prefix uniformly means "renderable UIElement".

- `PanelNode` → `UIPanel`, `ScrollViewNode` → `UIScrollView`; props types `PanelProps` → `UIPanelProps`, `ScrollViewProps` → `UIScrollViewProps` (aligning with the `UI<Element>Props` convention).
- The `UIPanel` Component is now `UISurface` (options type `UIPanelOptions` → `UISurfaceOptions`). Its root element is exposed as a public `readonly root: UIPanel`, replacing the internal `_node` field.
- `attachTooltip` takes `anchor: UIElement` only — the `UIElement | UIPanel` union is gone. A caller holding a surface passes `surface.root`.
- Save-snapshot caveat: the serializable type string follows the class name, so saves written before this rename that contain a `UIPanel` component no longer restore it (no registry alias is provided).
