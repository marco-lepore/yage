---
"@yagejs/ui": patch
---

Fix panel children that render outside the panel's box — an open `PixiSelect` dropdown, a popover — receiving no pointer or hover events.

Pixi treats a container's `hitArea` as a subtree prune gate: for a point outside the rectangle it skips the container and every descendant. A panel set its box-covering `hitArea` on its own container, so a child extending past the box (a dropdown opening downward) was pruned — only the portion still inside the box was clickable. The box-covering hitArea now lives on a dedicated transparent leaf child, which prunes nothing else: empty-region hover/click and the UI auto-consume fallback still cover the whole box, and overflowing children stay hittable.
