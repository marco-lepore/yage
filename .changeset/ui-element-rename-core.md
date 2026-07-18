---
"@yagejs/core": patch
---

Rename the UI element/Component split so the `UI*` prefix uniformly means "renderable UIElement".

- The Inspector's UI-tree snapshot recognizes the renamed root component: it matches components named `UISurface` with a `root` element (previously `UIPanel` with `_node`) and emits `entity-<id>:UISurface:<i>` node ids.
